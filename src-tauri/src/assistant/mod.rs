//! The assistant's providers and keys, as Settings sets them up. Keys stay
//! in Rust: they're read from the credential store only to send to their
//! own provider, and nothing here hands them back to the webview.

mod catalog;
mod chat;
mod engine;
mod files;
mod inline;
mod local;
mod memory;
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
pub use memory::Memory;
use models::Target;
pub use models::{Model, ProviderError};
pub use providers::Api;
use providers::{Limits, Provider, Setup};
use serde::{Deserialize, Serialize};
pub use sessions::ChatInfo;
use sessions::{Change, ChangeState, Offer};
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
    /// Whether a shard's images and PDFs go to the model with it.
    send_files: bool,
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

/// Where the provider's key is kept, without reading it.
fn key_kept(provider: &Provider) -> Result<Option<Storage>, String> {
    match provider.credential {
        Some(credential) => credentials::kept(credential),
        None => Ok(None),
    }
}

/// Whether the assistant is on, read from its setting alone.
pub fn enabled() -> Result<bool, String> {
    db::settings::assistant_enabled(&db::open_connection()?).map_err(|e| e.to_string())
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
                key: key_kept(provider)?,
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
        send_files: db::settings::assistant_send_files(&conn).map_err(|e| e.to_string())?,
        keyring_available: credentials::keyring_available(),
        model: read_in(&conn, MODEL)?,
        providers,
    })
}

/// Turns the assistant on or off. Off stops every answer and drops every
/// change not applied yet, writing nothing.
pub fn set_enabled(enabled: bool) -> Result<(), String> {
    db::settings::set_assistant_enabled(&db::open_connection()?, enabled)
        .map_err(|e| e.to_string())?;
    if !enabled {
        stop_all();
        if sessions::path().is_ok_and(|path| path.exists()) {
            let store = store().map_err(|_| "Couldn't open the saved chats".to_string())?;
            let store = store
                .lock()
                .map_err(|_| "Saved chats are locked".to_string())?;
            store.discard_pending()?;
        }
    }
    Ok(())
}

pub fn set_send_files(on: bool) -> Result<(), String> {
    db::settings::set_assistant_send_files(&db::open_connection()?, on).map_err(|e| e.to_string())
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
    /// The shards added to a user's message.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    shards: Vec<String>,
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
    /// The changes its answers proposed, applied or not; discarded ones
    /// are left out.
    changes: Vec<Change>,
    /// The memory items its answers offered, added or not; discarded ones
    /// are left out.
    memories: Vec<Offer>,
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

/// Sends `text` in `chat`, or in a new chat about `vault`, with `shards`
/// added to it, and streams the answer to `sink`. Gives the chat's id once the answer ends.
pub async fn send(
    chat: Option<String>,
    vault: String,
    text: String,
    shards: Vec<String>,
    window: String,
    sink: impl Sink + 'static,
) -> Result<String, ChatError> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(ChatError::Failed);
    }
    let store = store()?;
    let (chat, vault, mut model, send_files) = {
        let store = store.clone();
        let text = text.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let model = picked_model()?;
            let send_files = db::open_connection()
                .and_then(|conn| {
                    db::settings::assistant_send_files(&conn).map_err(|e| e.to_string())
                })
                .map_err(|_| ChatError::Storage)?;
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
            Ok::<_, ChatError>((chat, vault, model, send_files))
        })
        .await
        .map_err(|_| ChatError::Failed)??
    };
    // A local model says itself whether it sees images, and Ollama what
    // context it's loaded with, so long chats are summarized in time.
    if model.target.api == Api::Ollama {
        let (target, id) = (&model.target, &model.id);
        let (images, context) = tokio::join!(
            async {
                match send_files {
                    true => Some(local::sees_images(target, id).await),
                    false => None,
                }
            },
            local::loaded_context(target, id),
        );
        if let Some(images) = images {
            model.facts.images = images;
        }
        model.facts.context = context;
    }

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
        send_files,
        added: shards,
        asked: Default::default(),
        memory: Arc::new(memory::List::open().map_err(|error| {
            eprintln!("[Netherstone] {error}");
            ChatError::Storage
        })?),
    };
    let result = run(&turn, &text, &sink).await;
    if let Ok(mut running) = running().lock() {
        running.remove(&chat);
    }
    sink.send(Event::ending(result));
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
    let (shards, files) = engine::attach(turn, &turn.added).await;
    let message = Message::User {
        text: text.to_string(),
        shards,
        files,
    };
    let asked = engine::saved(&turn.store, move |store| {
        store.add(&chat, &message, &[], None)
    })
    .await?;
    turn.asked.store(asked, std::sync::atomic::Ordering::SeqCst);
    engine::answer(turn, sink).await
}

/// Asks for a change to `selection` (Markdown) in `shard`, and streams the
/// Markdown that replaces it to `sink`. `id` names the request, so it can
/// be stopped like a chat. Nothing is saved.
#[allow(clippy::too_many_arguments)]
pub async fn ask_inline(
    id: String,
    vault: String,
    shard: String,
    selection: String,
    whole: bool,
    prompt: String,
    window: String,
    sink: impl Sink + 'static,
) -> Result<(), ChatError> {
    if prompt.trim().is_empty() || selection.trim().is_empty() {
        return Err(ChatError::Failed);
    }
    // Registered first, so a stop that comes while it's setting up counts.
    let stop = StopToken::default();
    {
        let mut running = running().lock().map_err(|_| ChatError::Failed)?;
        if running.contains_key(&id) {
            return Err(ChatError::Answering);
        }
        running.insert(id.clone(), (window, stop.clone()));
    }
    let result = ask_inline_run(vault, shard, selection, whole, prompt, stop, &sink).await;
    if let Ok(mut running) = running().lock() {
        running.remove(&id);
    }
    match result {
        // Set up, then answered or not: the stream says how it went.
        Ok(answered) => {
            sink.send(Event::ending(answered));
            Ok(())
        }
        Err(error) => Err(error),
    }
}

/// Sets up an inline Ask and runs it, unless it's stopped first.
async fn ask_inline_run(
    vault: String,
    shard: String,
    selection: String,
    whole: bool,
    prompt: String,
    stop: StopToken,
    sink: &dyn Sink,
) -> Result<Result<(chat::Stop, chat::Usage), ChatError>, ChatError> {
    let (vault, mut model, send_files) = tauri::async_runtime::spawn_blocking(move || {
        let model = picked_model()?;
        let send_files = db::open_connection()
            .and_then(|conn| db::settings::assistant_send_files(&conn).map_err(|e| e.to_string()))
            .map_err(|_| ChatError::Storage)?;
        let vault = open_vault(&PathBuf::from(vault))?;
        Ok::<_, ChatError>((vault, model, send_files))
    })
    .await
    .map_err(|_| ChatError::Failed)??;
    if send_files && model.target.api == Api::Ollama {
        model.facts.images = local::sees_images(&model.target, &model.id).await;
    }
    if stop.is_stopped() {
        return Ok(Err(ChatError::Stopped));
    }
    let ask = inline::Ask {
        vault: Arc::new(vault),
        model,
        stop,
        send_files,
        shard,
        selection,
        whole,
        prompt,
    };
    Ok(inline::rewrite(&ask, sink).await)
}

/// Stops `chat` if it's answering.
pub fn stop(chat: &str) {
    if let Some((_, stop)) = running().lock().ok().and_then(|r| r.get(chat).cloned()) {
        stop.stop();
    }
}

fn stop_all() {
    if let Ok(running) = running().lock() {
        for (_, stop) in running.values() {
            stop.stop();
        }
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

/// Gives a new chat a short name from its first question and answer, with
/// one small call to the model. Its first title stays when that fails. Only
/// while the assistant is on and may use the chat's vault; turning it off
/// stops it like an answer.
pub async fn retitle(chat: String, window: String) -> Result<String, ChatError> {
    // Registered first, so turning off while it's setting up counts.
    let key = format!("title:{chat}");
    let stop = StopToken::default();
    {
        let mut running = running().lock().map_err(|_| ChatError::Failed)?;
        if running.contains_key(&key) {
            return Err(ChatError::Answering);
        }
        running.insert(key.clone(), (window, stop.clone()));
    }
    let result = retitle_run(chat, &stop).await;
    if let Ok(mut running) = running().lock() {
        running.remove(&key);
    }
    result
}

async fn retitle_run(chat: String, stop: &StopToken) -> Result<String, ChatError> {
    let store = store()?;
    let id = chat.clone();
    let (info, messages) = engine::saved(&store, move |store| {
        Ok((store.info(&id)?, store.messages(&id)?))
    })
    .await?;
    let info = info.ok_or(ChatError::NoChat)?;
    let question = messages.iter().find_map(|saved| match &saved.message {
        Message::User { text, .. } => Some(text.clone()),
        _ => None,
    });
    let answer = messages.iter().find_map(|saved| match &saved.message {
        Message::Assistant { text, .. } if !text.trim().is_empty() => Some(text.clone()),
        _ => None,
    });
    let (Some(question), Some(answer)) = (question, answer) else {
        return Err(ChatError::Failed);
    };
    let model = tauri::async_runtime::spawn_blocking(move || {
        open_vault(&PathBuf::from(info.vault))?;
        picked_model()
    })
    .await
    .map_err(|_| ChatError::Failed)??;
    if stop.is_stopped() {
        return Err(ChatError::Stopped);
    }
    let title = engine::short_title(&model, &chat, &question, &answer, stop).await?;
    let kept = title.clone();
    engine::saved(&store, move |store| store.set_title(&chat, &kept)).await?;
    Ok(sessions::title_of(&title))
}

pub async fn chat_view(chat: String) -> Result<ChatView, ChatError> {
    let found = engine::saved(&store()?, move |store| {
        Ok(store.info(&chat)?.map(|info| {
            (
                info,
                store.messages(&chat),
                store.changes(&chat),
                store.offers(&chat),
            )
        }))
    })
    .await?;
    let (info, messages, changes, offers) = found.ok_or(ChatError::NoChat)?;
    let messages = messages.map_err(|_| ChatError::Storage)?;
    let changes = changes.map_err(|_| ChatError::Storage)?;
    let offers = offers.map_err(|_| ChatError::Storage)?;
    Ok(ChatView {
        info,
        messages: messages.into_iter().filter_map(shown).collect(),
        changes: changes
            .into_iter()
            .filter(|change| change.state != ChangeState::Discarded)
            .collect(),
        memories: offers
            .into_iter()
            .filter(|offer| offer.state != ChangeState::Discarded)
            .collect(),
    })
}

fn shown(saved: sessions::Saved) -> Option<Shown> {
    let mut shards = Vec::new();
    let (role, text, reasoning, tools) = match saved.message {
        Message::User {
            text,
            shards: added,
            ..
        } => {
            shards = added.into_iter().map(|shard| shard.path).collect();
            ("user", text, None, Vec::new())
        }
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
        shards,
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
    stop_all();
    engine::saved(&store()?, |store| store.delete_all()).await
}

// ── Proposed changes ─────────────────────────────────────────────────────────

/// A proposed change to a shard, as the editor previews it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// Vault-relative.
    path: String,
    /// The shard or drawing as it is now, empty for a new one.
    before: String,
    /// The shard or drawing as applying would leave it.
    after: String,
}

/// What applying or undoing left a shard with, for the editor to show.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Made {
    /// Vault-relative.
    path: String,
    /// Its text now, or None when it's gone.
    content: Option<String>,
}

fn store_error(error: String) -> String {
    eprintln!("[Netherstone] {error}");
    "Couldn't read the saved chats".to_string()
}

fn error_text(error: ChatError) -> String {
    match error {
        ChatError::TurnedOff => "The assistant is off".to_string(),
        ChatError::VaultClosed => "This vault is off for AI".to_string(),
        _ => "Couldn't read the saved chats".to_string(),
    }
}

/// The change `id` in a pending or applied state as `wanted`, with the vault
/// of its chat, while the assistant is on and may use it.
fn change_and_vault(
    store: &sessions::Store,
    id: &str,
    wanted: ChangeState,
) -> Result<(Change, crate::tools::Vault), String> {
    let change = store
        .change(id)
        .map_err(store_error)?
        .filter(|change| change.state == wanted)
        .ok_or_else(|| "That change isn't there anymore".to_string())?;
    let info = store
        .info(&change.chat)
        .map_err(store_error)?
        .ok_or_else(|| "That chat was deleted".to_string())?;
    let vault = open_vault(std::path::Path::new(&info.vault)).map_err(error_text)?;
    Ok((change, vault))
}

/// Runs `work` on the saved chats, off the async threads.
async fn with_store<T: Send + 'static>(
    work: impl FnOnce(&sessions::Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let store = store().map_err(error_text)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = store
            .lock()
            .map_err(|_| "Saved chats are locked".to_string())?;
        work(&store)
    })
    .await
    .map_err(|_| "Couldn't read the saved chats".to_string())?
}

fn target_of(change: &Change) -> crate::tools::proposals::Target {
    crate::tools::proposals::Target {
        kind: change.kind,
        path: change.path.clone(),
    }
}

/// The text a pending change would leave its shard or drawing with, and
/// the text it has now: none for a new one. A move has none to show.
pub async fn preview(id: String) -> Result<Preview, String> {
    with_store(move |store| {
        let (change, vault) = change_and_vault(store, &id, ChangeState::Pending)?;
        let target = target_of(&change);
        use crate::tools::proposals::Kind;
        let before = match change.kind {
            Kind::NewShard | Kind::NewDrawing => None,
            Kind::Shard | Kind::Drawing => Some(
                crate::tools::proposals::current(&vault, &target)
                    .ok_or_else(|| format!("There's nothing at '{}'", change.path))?,
            ),
            Kind::Move => return Err("A move has no text to show".to_string()),
        };
        let after = crate::tools::proposals::replay(&vault, before.clone(), &change.ops)
            .map_err(|error| error.0)?;
        Ok(Preview {
            path: change.path,
            before: before.unwrap_or_default(),
            after,
        })
    })
    .await
}

/// History's line for a change: what the model said it did, and the model.
fn history_summary(lines: &[String], model: Option<&str>) -> Option<String> {
    let said = lines.join("; ");
    match (said.is_empty(), model) {
        (true, model) => model.map(str::to_string),
        (false, Some(model)) => Some(format!("{said} ({model})")),
        (false, None) => Some(said),
    }
}

const CALLER: &str = "Assistant";

fn caller() -> crate::tools::Caller {
    crate::tools::Caller {
        app: CALLER.to_string(),
    }
}

/// What `files` left at `path`, the change's own file.
fn made(files: &[crate::tools::proposals::FileChange], path: &str) -> Made {
    Made {
        path: path.to_string(),
        content: files
            .iter()
            .find(|file| file.path == path)
            .and_then(|file| file.after.clone()),
    }
}

/// Makes a pending change. `expected` is the shard's text as the editor
/// shows it, when it's open.
pub async fn apply(id: String, expected: Option<String>) -> Result<Made, String> {
    with_store(move |store| {
        let (change, vault) = change_and_vault(store, &id, ChangeState::Pending)?;
        let summary = history_summary(
            &crate::tools::proposals::summaries(&change.ops),
            change.model.as_deref(),
        );
        let files = crate::tools::proposals::apply(
            &vault,
            &caller(),
            summary.as_deref(),
            &target_of(&change),
            &change.ops,
            expected.as_deref(),
        )
        .map_err(|error| error.0)?;
        // A new file goes where it was made; a move, where it went.
        let path = match change.kind {
            crate::tools::proposals::Kind::Shard | crate::tools::proposals::Kind::Drawing => {
                change.path.clone()
            }
            _ => files
                .iter()
                .find(|file| file.before.is_none())
                .map_or(change.path.clone(), |file| file.path.clone()),
        };
        store
            .set_change_state(&id, ChangeState::Applied, &files, &path)
            .map_err(store_error)?;
        Ok(made(&files, &path))
    })
    .await
}

/// Takes back an applied change, while its files are as it left them. It
/// can then be applied again.
pub async fn undo(id: String) -> Result<Made, String> {
    with_store(move |store| {
        let (change, vault) = change_and_vault(store, &id, ChangeState::Applied)?;
        let summary = history_summary(&["Undid a change".to_string()], change.model.as_deref());
        let files =
            crate::tools::proposals::undo(&vault, &caller(), summary.as_deref(), &change.applied)
                .map_err(|error| error.0)?;
        // Pending again, where it was first proposed.
        let path = match change.kind {
            crate::tools::proposals::Kind::Move => change
                .applied
                .iter()
                .find(|file| file.after.is_none())
                .map_or(change.path.clone(), |file| file.path.clone()),
            _ => change.path.clone(),
        };
        store
            .set_change_state(&id, ChangeState::Pending, &[], &path)
            .map_err(store_error)?;
        Ok(made(&files, &change.path))
    })
    .await
}

/// Drops a pending change, writing nothing.
pub async fn discard(id: String) -> Result<(), String> {
    with_store(move |store| {
        let change = store
            .change(&id)
            .map_err(store_error)?
            .filter(|change| change.state == ChangeState::Pending)
            .ok_or_else(|| "That change isn't there anymore".to_string())?;
        store
            .set_change_state(&id, ChangeState::Discarded, &[], &change.path)
            .map_err(store_error)
    })
    .await
}

// ── Memory ───────────────────────────────────────────────────────────────────

fn memory_list() -> Result<memory::List, String> {
    memory::List::open().map_err(|error| {
        eprintln!("[Netherstone] {error}");
        "Couldn't open memory".to_string()
    })
}

/// The memory list, for Settings. It stays saved while the assistant is off.
pub fn memory() -> Result<Memory, String> {
    memory_list()?.shown()
}

/// Puts `text` in `item`'s place, and gives the list as it now is.
pub fn edit_memory(item: &str, text: &str) -> Result<Memory, String> {
    let list = memory_list()?;
    list.edit(item, text)?;
    list.shown()
}

pub fn delete_memory(item: &str) -> Result<Memory, String> {
    let list = memory_list()?;
    list.remove(item)?;
    list.shown()
}

pub fn delete_all_memory() -> Result<(), String> {
    memory_list()?.clear()
}

/// The offer `id` while it's `wanted`, and the assistant is on.
fn offer_in(store: &sessions::Store, id: &str, wanted: ChangeState) -> Result<Offer, String> {
    let conn = db::open_connection()?;
    if !ai_vaults::is_on(&conn, Way::Assistant)? {
        return Err(error_text(ChatError::TurnedOff));
    }
    store
        .offer(id)
        .map_err(store_error)?
        .filter(|offer| offer.state == wanted)
        .ok_or_else(|| "That memory item isn't there anymore".to_string())
}

/// Adds an item the assistant offered to memory.
pub async fn remember(id: String) -> Result<(), String> {
    with_store(move |store| {
        let offer = offer_in(store, &id, ChangeState::Pending)?;
        let added = memory_list()?.add(&offer.text)?;
        store
            .set_offer_state(&id, ChangeState::Applied, added)
            .map_err(store_error)
    })
    .await
}

/// Takes an added item back out of memory. It can then be added again.
pub async fn forget(id: String) -> Result<(), String> {
    with_store(move |store| {
        let offer = offer_in(store, &id, ChangeState::Applied)?;
        // An item that was in memory before stays, and so does one another
        // offer added and still shows as added.
        if offer.added && !store.added_elsewhere(&offer).map_err(store_error)? {
            let list = memory_list()?;
            if !list.remove(&offer.text)? {
                return Err("That item was changed or deleted in Settings".to_string());
            }
        }
        store
            .set_offer_state(&id, ChangeState::Pending, false)
            .map_err(store_error)
    })
    .await
}

/// Drops an offered item, adding nothing.
pub async fn discard_offer(id: String) -> Result<(), String> {
    with_store(move |store| {
        store
            .offer(&id)
            .map_err(store_error)?
            .filter(|offer| offer.state == ChangeState::Pending)
            .ok_or_else(|| "That memory item isn't there anymore".to_string())?;
        store
            .set_offer_state(&id, ChangeState::Discarded, false)
            .map_err(store_error)
    })
    .await
}
