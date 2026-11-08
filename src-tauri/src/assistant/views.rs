//! Saved chats as the panel shows them, and deleting them.

use super::chat::{ChatError, Message, ReasoningPart};
use super::engine::{self, SharedStore};
use super::runs::{stop, stop_all};
use super::sessions::{self, Change, ChangeState, ChatInfo, Offer};
use serde::Serialize;
use std::sync::{Arc, Mutex};

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
    /// The changes its answers proposed: pending, applied or discarded.
    changes: Vec<Change>,
    /// The memory items its answers offered, added or not; discarded ones
    /// are left out.
    memories: Vec<Offer>,
    /// How answers that didn't end well ended, by the turn they answered.
    endings: Vec<Ending>,
}

#[derive(Debug, Serialize)]
pub struct Ending {
    turn: i64,
    ending: serde_json::Value,
}

pub(super) fn store() -> Result<SharedStore, ChatError> {
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

pub async fn chats() -> Result<Vec<ChatInfo>, ChatError> {
    engine::saved(&store()?, |store| store.list()).await
}

pub async fn chat_view(chat: String) -> Result<ChatView, ChatError> {
    let found = engine::saved(&store()?, move |store| {
        Ok(store.info(&chat)?.map(|info| {
            (
                info,
                store.messages(&chat),
                store.changes(&chat),
                store.offers(&chat),
                store.endings(&chat),
            )
        }))
    })
    .await?;
    let (info, messages, changes, offers, endings) = found.ok_or(ChatError::NoChat)?;
    let endings = endings.map_err(|_| ChatError::Storage)?;
    let messages = messages.map_err(|_| ChatError::Storage)?;
    let changes = changes.map_err(|_| ChatError::Storage)?;
    let offers = offers.map_err(|_| ChatError::Storage)?;
    Ok(ChatView {
        info,
        messages: messages.into_iter().filter_map(shown).collect(),
        // A discarded change stays in the chat as a trace of what was turned down.
        changes,
        memories: offers
            .into_iter()
            .filter(|offer| offer.state != ChangeState::Discarded)
            .collect(),
        endings: endings
            .into_iter()
            .map(|(turn, ending)| Ending { turn, ending })
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
