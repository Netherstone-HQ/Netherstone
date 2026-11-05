//! The assistant's providers and keys, as Settings sets them up. Keys stay
//! in Rust: they're read from the credential store only to send to their
//! own provider, and nothing here hands them back to the webview.

mod catalog;
mod chat;
mod engine;
mod local;
mod models;
mod providers;
mod sessions;

use crate::ai_vaults::{self, Way};
use crate::credentials::{self, Storage};
use crate::db;
pub use chat::ChatError;
use chat::{Message, ReasoningPart, StopToken};
pub use engine::{Event, Sink};
use engine::{SharedStore, Turn};
use local::Server;
use models::Target;
pub use models::{Model, ProviderError};
pub use providers::Api;
use providers::{Limits, Provider, Setup};
use serde::{Deserialize, Serialize};
pub use sessions::ChatInfo;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

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

// ── Chats ────────────────────────────────────────────────────────────────────

/// A message as the panel shows it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Shown {
    seq: i64,
    /// "user" or "assistant".
    role: &'static str,
    text: String,
    /// The model's shown reasoning, when it gave some.
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<String>,
    /// The tools it called, by name.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    sources: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatView {
    #[serde(flatten)]
    info: ChatInfo,
    messages: Vec<Shown>,
}

/// The chats answering now: their window, and how to stop them.
fn running() -> &'static Mutex<HashMap<String, (String, StopToken)>> {
    static RUNNING: std::sync::OnceLock<Mutex<HashMap<String, (String, StopToken)>>> =
        std::sync::OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

fn store() -> Result<SharedStore, ChatError> {
    static STORE: std::sync::OnceLock<SharedStore> = std::sync::OnceLock::new();
    if let Some(store) = STORE.get() {
        return Ok(store.clone());
    }
    let opened = sessions::Store::open().map_err(|error| {
        eprintln!("[Netherstone] {error}");
        ChatError::Storage
    })?;
    Ok(STORE.get_or_init(|| Arc::new(Mutex::new(opened))).clone())
}

/// The picked model, ready to call.
fn picked_model() -> Result<engine::Model, ChatError> {
    let choice: ModelChoice = read(MODEL)
        .map_err(|_| ChatError::Storage)?
        .ok_or(ChatError::NoModel)?;
    let provider = providers::find(&choice.provider).map_err(|_| ChatError::NoModel)?;
    let target = target(provider, choice.server.as_deref()).map_err(|error| match error {
        ProviderError::Storage => ChatError::Storage,
        _ => ChatError::NoModel,
    })?;
    if provider.setup == Setup::Key && target.key.is_none() {
        return Err(ChatError::NoModel);
    }
    let facts = catalog::facts(target.api, &choice.model);
    Ok(engine::Model {
        target,
        id: choice.model,
        facts,
    })
}

/// The vault at `path`, while the assistant is on and may use it.
fn open_vault(path: &std::path::Path) -> Result<crate::tools::Vault, ChatError> {
    let conn = db::open_connection().map_err(|_| ChatError::Storage)?;
    if !ai_vaults::is_on(&conn, Way::Assistant).map_err(|_| ChatError::Storage)? {
        return Err(ChatError::TurnedOff);
    }
    let known = ai_vaults::picked(&conn, path)
        .map_err(|_| ChatError::Storage)?
        .ok_or(ChatError::VaultClosed)?;
    ai_vaults::open(known).map_err(|_| ChatError::VaultClosed)
}

/// Sends `text` in `chat`, or in a new chat about `vault`, and streams the
/// answer to `sink`. Gives the chat's id once the answer ends.
pub async fn send(
    chat: Option<String>,
    vault: String,
    text: String,
    window: String,
    sink: impl Sink + 'static,
) -> Result<String, ChatError> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(ChatError::Failed);
    }
    let store = store()?;
    let (chat, vault, model) = {
        let store = store.clone();
        let text = text.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let model = picked_model()?;
            let store = store.lock().map_err(|_| ChatError::Storage)?;
            let storage = |error: String| {
                eprintln!("[Netherstone] {error}");
                ChatError::Storage
            };
            // A chat stays with the vault it was started in.
            let (chat, vault_path) = match chat {
                Some(chat) => {
                    let info = store
                        .info(&chat)
                        .map_err(storage)?
                        .ok_or(ChatError::NoChat)?;
                    (chat, PathBuf::from(info.vault))
                }
                None => {
                    let path = PathBuf::from(&vault);
                    let vault = open_vault(&path)?;
                    let chat = store.create(&vault.root, &text).map_err(storage)?;
                    (chat, path)
                }
            };
            let vault = open_vault(&vault_path)?;
            Ok::<_, ChatError>((chat, vault, model))
        })
        .await
        .map_err(|_| ChatError::Failed)??
    };

    let stop = StopToken::default();
    {
        let mut running = running().lock().map_err(|_| ChatError::Failed)?;
        if running.contains_key(&chat) {
            return Err(ChatError::Answering);
        }
        running.insert(chat.clone(), (window, stop.clone()));
    }
    let vault_path = vault.root.clone();
    let turn = Turn {
        store,
        chat: chat.clone(),
        vault: Arc::new(vault),
        model,
        stop: stop.clone(),
        allowed: Arc::new(move || open_vault(&vault_path).is_ok()),
    };
    let result = run(&turn, &text, &sink).await;
    if let Ok(mut running) = running().lock() {
        running.remove(&chat);
    }
    let event = match result {
        Ok((stop, usage)) => Event::Done { stop, usage },
        Err(ChatError::Stopped) => Event::Stopped,
        Err(error) => Event::Failed { error },
    };
    sink.send(event);
    Ok(chat)
}

async fn run(
    turn: &Turn,
    text: &str,
    sink: &dyn Sink,
) -> Result<(chat::Stop, chat::Usage), ChatError> {
    if !sink.send(Event::Chat {
        id: turn.chat.clone(),
    }) {
        return Err(ChatError::Stopped);
    }
    let chat = turn.chat.clone();
    let message = Message::User {
        text: text.to_string(),
    };
    engine::saved(&turn.store, move |store| {
        store.add(&chat, &message, &[], None).map(|_| ())
    })
    .await?;
    engine::answer(turn, sink).await
}

/// Stops `chat` if it's answering.
pub fn stop(chat: &str) {
    if let Some((_, stop)) = running().lock().ok().and_then(|r| r.get(chat).cloned()) {
        stop.stop();
    }
}

/// Stops every chat answering in `window`, as it reloads or closes.
pub fn stop_window(window: &str) {
    if let Ok(running) = running().lock() {
        for (owner, stop) in running.values() {
            if owner == window {
                stop.stop();
            }
        }
    }
}

pub async fn chats() -> Result<Vec<ChatInfo>, ChatError> {
    engine::saved(&store()?, |store| store.list()).await
}

pub async fn chat_view(chat: String) -> Result<ChatView, ChatError> {
    let found = engine::saved(&store()?, move |store| {
        Ok(store.info(&chat)?.map(|info| (info, store.messages(&chat))))
    })
    .await?;
    let (info, messages) = found.ok_or(ChatError::NoChat)?;
    let messages = messages.map_err(|_| ChatError::Storage)?;
    Ok(ChatView {
        info,
        messages: messages.into_iter().filter_map(shown).collect(),
    })
}

fn shown(saved: sessions::Saved) -> Option<Shown> {
    let (role, text, reasoning, tools) = match saved.message {
        Message::User { text } => ("user", text, None, Vec::new()),
        Message::Assistant {
            text,
            calls,
            reasoning,
        } => {
            let reasoning: String = reasoning
                .iter()
                .flat_map(|r| &r.parts)
                .filter_map(|part| match part {
                    ReasoningPart::Text(text) => Some(text.as_str()),
                    _ => None,
                })
                .collect();
            (
                "assistant",
                text,
                Some(reasoning).filter(|r| !r.is_empty()),
                calls.into_iter().map(|call| call.name).collect(),
            )
        }
        Message::Tool { .. } => return None,
    };
    Some(Shown {
        seq: saved.seq,
        role,
        text,
        reasoning,
        tools,
        sources: saved.sources,
        model: saved.model,
    })
}

pub async fn delete_chat(chat: String) -> Result<(), ChatError> {
    stop(&chat);
    engine::saved(&store()?, move |store| store.delete(&chat)).await
}

pub async fn delete_chats() -> Result<(), ChatError> {
    if let Ok(running) = running().lock() {
        for (_, stop) in running.values() {
            stop.stop();
        }
    }
    engine::saved(&store()?, |store| store.delete_all()).await
}
