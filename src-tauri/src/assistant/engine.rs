//! The assistant's loop: send the chat, stream the answer, run the vault
//! tools the model calls, and go again until it answers, within a step
//! limit. Read tools run; write tools only propose their change, which the
//! user applies or discards (`tools::proposals`), checked here and not
//! left to the model. Shards it reads are the answer's sources. A chat
//! that grows near the model's limit has its older messages summarized
//! first.

mod context;
mod history;
mod run;
mod tools;

use super::catalog::Facts;
use super::chat::{ChatError, Stop, StopToken, Usage};
use super::memory::List;
use super::models::Target;
use super::sessions::Store;
use super::settings::Thinking;
use crate::tools::Vault;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicI64};
use std::sync::{Arc, Mutex};

pub(super) use run::{Out, answer};
pub use tools::attach;

/// What the webview hears while a chat answers, in order.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Event {
    /// The chat this answer belongs to, first.
    Chat {
        id: String,
    },
    Text {
        text: String,
    },
    Reasoning {
        text: String,
    },
    /// A tool started, with the shards or folders it's about.
    Tool {
        name: String,
        paths: Vec<String>,
    },
    /// The shards read so far.
    Sources {
        shards: Vec<String>,
    },
    /// Older messages were summarized to make room.
    Summarized,
    /// The provider failed for now, and is asked again after a wait.
    Retrying {
        error: ChatError,
    },
    Done {
        stop: Stop,
        usage: Usage,
    },
    /// The model kept calling tools past the step limit.
    StepLimit,
    Failed {
        error: ChatError,
    },
    Stopped,
}

impl Event {
    /// The last event of an answer, from how it went.
    pub fn ending(result: Result<(Stop, Usage), ChatError>) -> Self {
        match result {
            Ok((stop, usage)) => Event::Done { stop, usage },
            Err(ChatError::Stopped) => Event::Stopped,
            Err(error) => Event::Failed { error },
        }
    }
}

/// Where events go. False once nobody's listening, which stops the chat.
pub trait Sink: Send + Sync {
    fn send(&self, event: Event) -> bool;
}

/// The model a chat talks to.
#[derive(Clone)]
pub struct Model {
    pub target: Target,
    pub id: String,
    pub facts: Facts,
    /// How much it thinks, for a model that can.
    pub thinking: Option<Thinking>,
}

pub type SharedStore = Arc<Mutex<Store>>;

/// Runs `work` on the saved chats, off the async threads.
pub async fn saved<T: Send + 'static>(
    store: &SharedStore,
    work: impl FnOnce(&Store) -> Result<T, String> + Send + 'static,
) -> Result<T, ChatError> {
    let store = store.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let store = store
            .lock()
            .map_err(|_| "Saved chats are locked".to_string())?;
        work(&store)
    })
    .await
    .map_err(|_| ChatError::Storage)?
    .map_err(|error| {
        eprintln!("[Netherstone] {error}");
        ChatError::Storage
    })
}

/// One answer in a chat whose user message is already saved.
pub struct Turn {
    pub store: SharedStore,
    pub chat: String,
    pub vault: Arc<Vault>,
    pub model: Model,
    pub stop: StopToken,
    /// Whether the assistant may still use the vault, asked before tools run.
    pub allowed: Arc<dyn Fn() -> bool + Send + Sync>,
    /// The send-images-and-PDFs switch.
    pub send_files: bool,
    /// The shards added to the message being answered, which count as read.
    pub added: Vec<String>,
    /// The user message being answered, once it's saved: the changes
    /// proposed in this answer belong to it.
    pub asked: AtomicI64,
    /// Whether the answer stopped at the step limit.
    pub step_limited: AtomicBool,
    /// What the user asked the assistant to remember.
    pub memory: Arc<List>,
}

#[cfg(test)]
mod tests;
