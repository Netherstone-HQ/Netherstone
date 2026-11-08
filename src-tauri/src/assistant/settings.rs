//! The assistant's settings: its switch, the picked model and where each
//! provider is, kept in the app's settings.

use super::local::Server;
use super::providers::{self, Api, Limits, Provider, Setup};
use super::runs::stop_all;
use super::sessions;
use super::views::store;
use crate::credentials::{self, Storage};
use crate::db;
use serde::{Deserialize, Serialize};

/// The servers found on this computer, as JSON.
pub(super) const LOCAL_SERVERS: &str = "assistant_local_servers";
/// The Custom address and the API it speaks, as JSON.
pub(super) const CUSTOM: &str = "assistant_custom";
/// The model picked for chats, as JSON.
pub(super) const MODEL: &str = "assistant_model";
/// How much each model thinks, by model, as JSON.
const THINKING: &str = "assistant_thinking";

/// How much a model that can think does, before it answers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Thinking {
    #[default]
    Low,
    Medium,
    High,
}

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

pub(super) fn read<T: serde::de::DeserializeOwned>(key: &str) -> Result<Option<T>, String> {
    read_in(&db::open_connection()?, key)
}

fn read_in<T: serde::de::DeserializeOwned>(
    conn: &rusqlite::Connection,
    key: &str,
) -> Result<Option<T>, String> {
    let value = db::settings::get(conn, key).map_err(|e| e.to_string())?;
    Ok(value.and_then(|json| serde_json::from_str(&json).ok()))
}

pub(super) fn write<T: Serialize>(key: &str, value: Option<&T>) -> Result<(), String> {
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

pub(super) fn servers() -> Result<Vec<Server>, String> {
    Ok(read(LOCAL_SERVERS)?.unwrap_or_default())
}

pub(super) fn saved_key(provider: &Provider) -> Result<Option<(String, Storage)>, String> {
    match provider.credential {
        Some(credential) => credentials::load(credential),
        None => Ok(None),
    }
}

/// Where the provider's key is kept, without reading it.
pub(super) fn key_kept(provider: &Provider) -> Result<Option<Storage>, String> {
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

/// How much each model thinks, by `thinking_key`.
type Levels = std::collections::HashMap<String, Thinking>;

/// Where a model's thinking is kept: one entry per model, per provider and
/// server.
fn thinking_key(choice: &ModelChoice) -> String {
    let server = choice.server.as_deref().unwrap_or_default();
    format!("{}|{server}|{}", choice.provider, choice.model)
}

fn level_in(levels: &Levels, choice: &ModelChoice) -> Thinking {
    levels
        .get(&thinking_key(choice))
        .copied()
        .unwrap_or_default()
}

/// How much `choice` thinks: Low until picked otherwise.
pub(super) fn thinking(choice: &ModelChoice) -> Result<Thinking, String> {
    Ok(level_in(&read(THINKING)?.unwrap_or_default(), choice))
}

/// Sets how much the picked model thinks, remembered for that model.
pub fn set_thinking(level: Thinking) -> Result<(), String> {
    let Some(choice) = read::<ModelChoice>(MODEL)? else {
        return Err("No model is picked".to_string());
    };
    let mut levels: Levels = read(THINKING)?.unwrap_or_default();
    levels.insert(thinking_key(&choice), level);
    write(THINKING, Some(&levels))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_model_keeps_its_own_thinking() {
        let choice = |provider: &str, server: Option<&str>, model: &str| ModelChoice {
            provider: provider.to_string(),
            server: server.map(str::to_string),
            model: model.to_string(),
        };
        let sonnet = choice("anthropic", None, "claude-sonnet-5-5");
        let qwen = choice("local", Some("http://127.0.0.1:11434/"), "qwen3:8b");
        let qwen_elsewhere = choice("local", Some("http://127.0.0.1:1234/"), "qwen3:8b");
        let mut levels = Levels::new();
        levels.insert(thinking_key(&sonnet), Thinking::High);
        levels.insert(thinking_key(&qwen), Thinking::Medium);
        assert_eq!(level_in(&levels, &sonnet), Thinking::High);
        assert_eq!(level_in(&levels, &qwen), Thinking::Medium);
        // Unset, or the same model on another server: Low.
        assert_eq!(level_in(&levels, &qwen_elsewhere), Thinking::Low);
        assert_eq!(
            level_in(&levels, &choice("openai", None, "gpt-5.5")),
            Thinking::Low
        );
    }
}
