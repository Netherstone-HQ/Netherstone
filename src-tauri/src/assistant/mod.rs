//! The assistant: its providers and settings, the chats it answers and
//! the changes and memory items it proposes.

mod catalog;
mod changes;
mod chat;
pub mod commands;
mod engine;
mod files;
mod inline;
mod local;
mod memory;
mod models;
mod prompts;
mod providers;
mod runs;
mod sessions;
mod settings;
mod setup;
mod titles;
mod views;

pub use changes::{Made, Preview, apply, discard, preview, undo};
pub use chat::ChatError;
pub use engine::{Event, Sink};
pub use local::ServerKind;
pub use memory::{
    Memory, delete_all_memory, delete_memory, discard_offer, edit_memory, forget, memory, remember,
};
pub use models::{Model, ProviderError};
pub use providers::Api;
pub use runs::{ask_inline, send, stop, stop_window};
pub use sessions::ChatInfo;
pub use settings::{ModelChoice, Status, enabled, set_enabled, set_model, set_send_files, status};
pub use setup::{
    Found, Picked, find_local, local_down, models, picked, remove, save_custom, save_key,
    save_local,
};
pub use titles::retitle;
pub use views::{ChatView, chat_view, chats, delete_chat, delete_chats};
