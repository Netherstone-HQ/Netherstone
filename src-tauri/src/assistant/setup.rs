//! The assistant's providers and keys, as Settings sets them up. Keys stay
//! in Rust: they're read from the credential store only to send to their
//! own provider, and nothing here hands them back to the webview.

use super::local::{Server, ServerKind};
use super::models::{Model, ProviderError, Target};
use super::providers::{Api, Provider, Setup};
use super::settings::{
    CUSTOM, Custom, LOCAL_SERVERS, MODEL, ModelChoice, enabled, key_kept, read, saved_key, servers,
    write,
};
use super::{ChatError, catalog, engine, local, providers};
use crate::credentials;
use serde::Serialize;

/// A local server that answered, with its models.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    #[serde(flatten)]
    server: Server,
    models: Vec<Model>,
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
    target_with(provider, server, key)
}

/// [`target`] with `key` in place of the saved key.
fn target_with(
    provider: &Provider,
    server: Option<&str>,
    key: Option<String>,
) -> Result<Target, ProviderError> {
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
    super::models::list(&target).await
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
    let models = super::models::list(&target).await?;
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

    let models = super::models::list(&Target {
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

/// The picked model, ready to call.
pub(super) fn picked_model() -> Result<engine::Model, ChatError> {
    picked_model_with(true)
}

/// The picked model, with its key when `with_key`, or else only checked to
/// be saved, so showing the model never reads the keyring.
fn picked_model_with(with_key: bool) -> Result<engine::Model, ChatError> {
    let choice: ModelChoice = read(MODEL)
        .map_err(|_| ChatError::Storage)?
        .ok_or(ChatError::NoModel)?;
    let provider = providers::find(&choice.provider).map_err(|_| ChatError::NoModel)?;
    let server = choice.server.as_deref();
    let target = match with_key {
        true => target(provider, server),
        false => target_with(provider, server, None),
    }
    .map_err(|error| match error {
        ProviderError::Storage => ChatError::Storage,
        _ => ChatError::NoModel,
    })?;
    let has_key = match with_key {
        true => target.key.is_some(),
        false => key_kept(provider)
            .map_err(|_| ChatError::Storage)?
            .is_some(),
    };
    if provider.setup == Setup::Key && !has_key {
        return Err(ChatError::NoModel);
    }
    let facts = catalog::facts(target.api, &choice.model);
    Ok(engine::Model {
        target,
        id: choice.model,
        facts,
    })
}

/// The picked model, as the panel shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Picked {
    id: String,
    /// The name people know it by, when the catalog knows it.
    name: Option<String>,
    provider: &'static str,
    local: bool,
    /// Whether it takes images.
    images: bool,
}

/// The picked model, or None when none is picked or its provider isn't
/// set up anymore.
pub async fn picked() -> Result<Option<Picked>, ChatError> {
    let found = tauri::async_runtime::spawn_blocking(|| {
        let Some(choice) = read::<ModelChoice>(MODEL).map_err(|_| ChatError::Storage)? else {
            return Ok(None);
        };
        match picked_model_with(false) {
            Ok(model) => Ok(Some((choice, model))),
            Err(ChatError::NoModel) => Ok(None),
            Err(error) => Err(error),
        }
    })
    .await
    .map_err(|_| ChatError::Failed)??;
    let Some((choice, model)) = found else {
        return Ok(None);
    };
    let provider = providers::find(&choice.provider).map_err(|_| ChatError::NoModel)?;
    let images = match model.target.api {
        Api::Ollama => local::sees_images(&model.target, &model.id).await,
        _ => model.facts.images,
    };
    Ok(Some(Picked {
        id: model.id,
        name: model.facts.name,
        provider: provider.name,
        local: provider.setup == Setup::Local,
        images,
    }))
}

/// The kind of the picked model's local server when it doesn't answer now.
/// None while the assistant is off or the picked model isn't on a local
/// server, so nothing is probed then.
pub async fn local_down() -> Result<Option<ServerKind>, ProviderError> {
    let server = blocking(|| {
        if !enabled().map_err(storage_error)? {
            return Ok(None);
        }
        let Some(choice) = read::<ModelChoice>(MODEL).map_err(storage_error)? else {
            return Ok(None);
        };
        let local = providers::find(&choice.provider).is_ok_and(|p| p.setup == Setup::Local);
        if !local {
            return Ok(None);
        }
        Ok(servers()
            .map_err(storage_error)?
            .into_iter()
            .find(|saved| Some(&saved.address) == choice.server.as_ref()))
    })
    .await?;
    let Some(server) = server else {
        return Ok(None);
    };
    Ok(match local::answers(&server).await {
        Some(_) => None,
        None => Some(server.kind),
    })
}
