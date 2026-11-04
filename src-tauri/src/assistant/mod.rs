//! The assistant's providers and keys, as Settings sets them up. Keys stay
//! in Rust: they're read from the credential store only to send to their
//! own provider, and nothing here hands them back to the webview.

mod catalog;
mod local;
mod models;
mod providers;

use crate::credentials::{self, Storage};
use crate::db;
use local::Server;
use models::Target;
pub use models::{Model, ProviderError};
pub use providers::Api;
use providers::{Limits, Provider, Setup};
use serde::{Deserialize, Serialize};

/// The servers found on this computer, as JSON.
const LOCAL_SERVERS: &str = "assistant_local_servers";
/// The Custom address and the API it speaks, as JSON.
const CUSTOM: &str = "assistant_custom";
/// The model picked for chats, as JSON.
const MODEL: &str = "assistant_model";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Custom {
    /// The API base, ending in `/`.
    pub address: String,
    pub api: Api,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelChoice {
    pub provider: String,
    /// The local server's address, for a local model.
    pub server: Option<String>,
    pub model: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    id: &'static str,
    name: &'static str,
    setup: Setup,
    key_page: Option<&'static str>,
    /// Where its key is kept, once saved.
    key: Option<Storage>,
    limits: Limits,
    /// For the local provider: the servers found.
    servers: Vec<Server>,
    /// For Custom: where it is, once set up.
    custom: Option<Custom>,
}

/// A local server that answered, with its models.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    #[serde(flatten)]
    server: Server,
    models: Vec<Model>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    enabled: bool,
    keyring_available: bool,
    model: Option<ModelChoice>,
    providers: Vec<ProviderStatus>,
}

fn read<T: serde::de::DeserializeOwned>(key: &str) -> Result<Option<T>, String> {
    read_in(&db::open_connection()?, key)
}

fn read_in<T: serde::de::DeserializeOwned>(
    conn: &rusqlite::Connection,
    key: &str,
) -> Result<Option<T>, String> {
    let value = db::settings::get(conn, key).map_err(|e| e.to_string())?;
    Ok(value.and_then(|json| serde_json::from_str(&json).ok()))
}

fn write<T: Serialize>(key: &str, value: Option<&T>) -> Result<(), String> {
    let conn = db::open_connection()?;
    match value {
        Some(value) => {
            let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
            db::settings::set(&conn, key, &json)
        }
        None => db::settings::delete(&conn, key),
    }
    .map_err(|e| e.to_string())
}

fn servers() -> Result<Vec<Server>, String> {
    Ok(read(LOCAL_SERVERS)?.unwrap_or_default())
}

fn saved_key(provider: &Provider) -> Result<Option<(String, Storage)>, String> {
    match provider.credential {
        Some(credential) => credentials::load(credential),
        None => Ok(None),
    }
}

pub fn status() -> Result<Status, String> {
    let conn = db::open_connection()?;
    let enabled = db::settings::assistant_enabled(&conn).map_err(|e| e.to_string())?;
    let custom: Option<Custom> = read_in(&conn, CUSTOM)?;
    let servers: Vec<Server> = read_in(&conn, LOCAL_SERVERS)?.unwrap_or_default();
    let providers = providers::PROVIDERS
        .iter()
        .map(|provider| {
            let api = match provider.setup {
                Setup::Custom => custom.as_ref().map(|custom| custom.api),
                _ => provider.api,
            };
            Ok(ProviderStatus {
                id: provider.id,
                name: provider.name,
                setup: provider.setup,
                key_page: provider.key_page,
                key: saved_key(provider)?.map(|(_, storage)| storage),
                limits: api.map_or(Limits::UNKNOWN, Limits::of),
                servers: match provider.setup {
                    Setup::Local => servers.clone(),
                    _ => Vec::new(),
                },
                custom: match provider.setup {
                    Setup::Custom => custom.clone(),
                    _ => None,
                },
            })
        })
        .collect::<Result<_, String>>()?;
    Ok(Status {
        enabled,
        keyring_available: credentials::keyring_available(),
        model: read_in(&conn, MODEL)?,
        providers,
    })
}

pub fn set_enabled(enabled: bool) -> Result<(), String> {
    db::settings::set_assistant_enabled(&db::open_connection()?, enabled).map_err(|e| e.to_string())
}

pub fn set_model(choice: Option<ModelChoice>) -> Result<(), String> {
    write(MODEL, choice.as_ref())
}

/// Runs keyring and database work off the async threads: a locked keyring
/// can wait on its unlock prompt.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, ProviderError> + Send + 'static,
) -> Result<T, ProviderError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| ProviderError::Failed)?
}

fn storage_error(error: String) -> ProviderError {
    eprintln!("[Netherstone] {error}");
    ProviderError::Storage
}

/// Where `provider` is and its saved key, ready to send to.
fn target(provider: &Provider, server: Option<&str>) -> Result<Target, ProviderError> {
    let key = saved_key(provider)
        .map_err(storage_error)?
        .map(|(key, _)| key);
    match provider.setup {
        Setup::Key => Ok(Target {
            api: provider.api.ok_or(ProviderError::Failed)?,
            base_url: provider.base_url.ok_or(ProviderError::Failed)?.to_string(),
            key,
        }),
        Setup::Local => servers()
            .map_err(storage_error)?
            .into_iter()
            .find(|saved| Some(saved.address.as_str()) == server)
            .map(|saved| saved.target())
            .ok_or(ProviderError::Unreachable),
        Setup::Custom => {
            let custom: Custom = read(CUSTOM)
                .map_err(storage_error)?
                .ok_or(ProviderError::BadAddress)?;
            Ok(Target {
                api: custom.api,
                base_url: custom.address,
                key,
            })
        }
    }
}

/// The models a set-up provider offers now, or for the local provider, the
/// models of its server at `server`.
pub async fn models(provider: &str, server: Option<String>) -> Result<Vec<Model>, ProviderError> {
    let provider = providers::find(provider).map_err(|_| ProviderError::Failed)?;
    let target = blocking(move || target(provider, server.as_deref())).await?;
    models::list(&target).await
}

/// Saves a key for a provider set up by key, once the provider takes it.
pub async fn save_key(
    provider: &str,
    key: &str,
    remember: bool,
) -> Result<Vec<Model>, ProviderError> {
    let provider = providers::find(provider).map_err(|_| ProviderError::Failed)?;
    let (Setup::Key, Some(api), Some(base_url), Some(credential)) = (
        provider.setup,
        provider.api,
        provider.base_url,
        provider.credential,
    ) else {
        return Err(ProviderError::Failed);
    };
    let key = key.trim().to_string();
    let target = Target {
        api,
        base_url: base_url.to_string(),
        key: Some(key.clone()),
    };
    let models = models::list(&target).await?;
    blocking(move || credentials::save(credential, &key, remember).map_err(storage_error)).await?;
    Ok(models)
}

/// Adds `found` to the saved servers, keeping the ones added by address.
fn keep_servers(found: Vec<Server>) -> Result<(), ProviderError> {
    let mut servers = servers().map_err(storage_error)?;
    servers.retain(|saved| found.iter().all(|new| new.address != saved.address));
    servers.extend(found);
    write(LOCAL_SERVERS, Some(&servers)).map_err(storage_error)
}

/// Looks for servers on their usual ports, and keeps the ones found.
pub async fn find_local() -> Result<Vec<Found>, ProviderError> {
    let found = local::find().await;
    if !found.is_empty() {
        let servers: Vec<Server> = found.iter().map(|(server, _)| server.clone()).collect();
        blocking(move || keep_servers(servers)).await?;
    }
    Ok(found
        .into_iter()
        .map(|(server, models)| Found { server, models })
        .collect())
}

/// Keeps the server at a typed address on this computer, once it answers.
pub async fn save_local(address: &str) -> Result<Found, ProviderError> {
    let (server, models) = local::at(address).await?;
    let kept = server.clone();
    blocking(move || keep_servers(vec![kept])).await?;
    Ok(Found { server, models })
}

/// Sets up Custom at `address`, speaking `api`, once models answer there.
/// With no new key, a saved key is kept only while the address stays the
/// same: a key belongs to the address it was saved for.
pub async fn save_custom(
    address: &str,
    api: Api,
    key: Option<String>,
    remember: bool,
) -> Result<Vec<Model>, ProviderError> {
    if !matches!(api, Api::OpenAi | Api::Anthropic | Api::Google) {
        return Err(ProviderError::Failed);
    }
    let provider = providers::find("custom").map_err(|_| ProviderError::Failed)?;
    let credential = provider.credential.ok_or(ProviderError::Failed)?;
    let url = local::parse_address(address)?;
    let default_path = match api {
        Api::Google => "/v1beta/",
        _ => "/v1/",
    };
    let custom = Custom {
        address: local::base_url(&url, default_path),
        api,
    };

    let new_key = key
        .map(|key| key.trim().to_string())
        .filter(|key| !key.is_empty());
    let address = custom.address.clone();
    let (same_address, saved) = blocking(move || {
        let previous: Option<Custom> = read(CUSTOM).map_err(storage_error)?;
        let same_address = previous.is_some_and(|p| p.address == address);
        let saved = match same_address {
            true => saved_key(provider)
                .map_err(storage_error)?
                .map(|(key, _)| key),
            false => None,
        };
        Ok((same_address, saved))
    })
    .await?;
    let key = new_key.clone().or(saved);
    if key.is_some() && url.scheme() != "https" && !local::is_loopback(&url) {
        return Err(ProviderError::Insecure);
    }

    let models = models::list(&Target {
        api,
        base_url: custom.address.clone(),
        key: key.clone(),
    })
    .await?;

    blocking(move || {
        write(CUSTOM, Some(&custom)).map_err(storage_error)?;
        match (new_key, key) {
            (Some(key), _) => credentials::save(credential, &key, remember)
                .map(|_| ())
                .map_err(storage_error)?,
            (None, None) => credentials::clear(credential).map_err(storage_error)?,
            (None, Some(_)) => {}
        }
        if !same_address {
            forget_model_of("custom")?;
        }
        Ok(())
    })
    .await?;
    Ok(models)
}

fn forget_model_of(provider: &str) -> Result<(), ProviderError> {
    let choice: Option<ModelChoice> = read(MODEL).map_err(storage_error)?;
    if choice.is_some_and(|choice| choice.provider == provider) {
        write::<ModelChoice>(MODEL, None).map_err(storage_error)?;
    }
    Ok(())
}

/// Forgets a provider: its key, servers or address, and the model picked
/// from it.
pub fn remove(provider: &str) -> Result<(), String> {
    let provider = providers::find(provider)?;
    if let Some(credential) = provider.credential {
        credentials::clear(credential)?;
    }
    match provider.setup {
        Setup::Local => write::<Vec<Server>>(LOCAL_SERVERS, None)?,
        Setup::Custom => write::<Custom>(CUSTOM, None)?,
        Setup::Key => {}
    }
    forget_model_of(provider.id).map_err(|_| "Couldn't forget the model".to_string())
}
