//! The assistant's commands for the window.

use crate::assistant;

/// The assistant's switch, model and providers, without any key.
#[tauri::command(async)]
pub(crate) fn assistant_status() -> Result<assistant::Status, String> {
    assistant::status()
}

/// Whether the assistant is on, with nothing else read.
#[tauri::command(async)]
pub(crate) fn assistant_enabled() -> Result<bool, String> {
    assistant::enabled()
}

#[tauri::command(async)]
pub(crate) fn assistant_set_enabled(enabled: bool) -> Result<(), String> {
    assistant::set_enabled(enabled)
}

#[tauri::command(async)]
pub(crate) fn assistant_set_send_files(on: bool) -> Result<(), String> {
    assistant::set_send_files(on)
}

#[tauri::command(async)]
pub(crate) fn assistant_set_model(choice: Option<assistant::ModelChoice>) -> Result<(), String> {
    assistant::set_model(choice)
}

/// The models a set-up provider offers, asked of the provider.
#[tauri::command]
pub(crate) async fn assistant_models(
    provider: String,
    server: Option<String>,
) -> Result<Vec<assistant::Model>, assistant::ProviderError> {
    assistant::models(&provider, server).await
}

/// Checks a key with its provider, then keeps it.
#[tauri::command]
pub(crate) async fn assistant_save_key(
    provider: String,
    key: String,
    remember: bool,
) -> Result<Vec<assistant::Model>, assistant::ProviderError> {
    assistant::save_key(&provider, &key, remember).await
}

#[tauri::command]
pub(crate) async fn assistant_find_local() -> Result<Vec<assistant::Found>, assistant::ProviderError>
{
    assistant::find_local().await
}

/// The picked local server's kind when it isn't answering.
#[tauri::command]
pub(crate) async fn assistant_local_down()
-> Result<Option<assistant::ServerKind>, assistant::ProviderError> {
    assistant::local_down().await
}

#[tauri::command]
pub(crate) async fn assistant_save_local(
    address: String,
) -> Result<assistant::Found, assistant::ProviderError> {
    assistant::save_local(&address).await
}

#[tauri::command]
pub(crate) async fn assistant_save_custom(
    address: String,
    api: assistant::Api,
    key: Option<String>,
    remember: bool,
) -> Result<Vec<assistant::Model>, assistant::ProviderError> {
    assistant::save_custom(&address, api, key, remember).await
}

#[tauri::command(async)]
pub(crate) fn assistant_remove(provider: String) -> Result<(), String> {
    assistant::remove(&provider)
}

/// Streams a chat's events to the webview, until it stops listening.
struct ChatEvents(tauri::ipc::Channel<assistant::Event>);

impl assistant::Sink for ChatEvents {
    fn send(&self, event: assistant::Event) -> bool {
        self.0.send(event).is_ok()
    }
}

/// Sends a message in a chat, or starts one about `vault`, streaming the
/// answer over `events`. Gives the chat's id.
#[tauri::command]
pub(crate) async fn assistant_send(
    window: tauri::Window,
    chat: Option<String>,
    vault: String,
    text: String,
    shards: Vec<String>,
    events: tauri::ipc::Channel<assistant::Event>,
) -> Result<String, assistant::ChatError> {
    let label = window.label().to_string();
    assistant::send(chat, vault, text, shards, label, ChatEvents(events)).await
}

/// Asks for a change to a selection in a shard, streaming the Markdown
/// that replaces it over `events`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) async fn assistant_ask_inline(
    window: tauri::Window,
    id: String,
    vault: String,
    shard: String,
    selection: String,
    whole: bool,
    prompt: String,
    events: tauri::ipc::Channel<assistant::Event>,
) -> Result<(), assistant::ChatError> {
    let label = window.label().to_string();
    assistant::ask_inline(
        id,
        vault,
        shard,
        selection,
        whole,
        prompt,
        label,
        ChatEvents(events),
    )
    .await
}

/// The picked model, as the assistant panel shows it.
#[tauri::command]
pub(crate) async fn assistant_picked() -> Result<Option<assistant::Picked>, assistant::ChatError> {
    assistant::picked().await
}

#[tauri::command(async)]
pub(crate) fn assistant_stop(chat: String) {
    assistant::stop(&chat)
}

#[tauri::command]
pub(crate) async fn assistant_chats() -> Result<Vec<assistant::ChatInfo>, assistant::ChatError> {
    assistant::chats().await
}

#[tauri::command]
pub(crate) async fn assistant_retitle(
    window: tauri::Window,
    chat: String,
) -> Result<String, assistant::ChatError> {
    assistant::retitle(chat, window.label().to_string()).await
}

#[tauri::command]
pub(crate) async fn assistant_chat(
    chat: String,
) -> Result<assistant::ChatView, assistant::ChatError> {
    assistant::chat_view(chat).await
}

#[tauri::command]
pub(crate) async fn assistant_delete_chat(chat: String) -> Result<(), assistant::ChatError> {
    assistant::delete_chat(chat).await
}

#[tauri::command]
pub(crate) async fn assistant_delete_chats() -> Result<(), assistant::ChatError> {
    assistant::delete_chats().await
}

/// The text a change the assistant proposed would leave its shard with.
#[tauri::command]
pub(crate) async fn assistant_change_preview(change: String) -> Result<assistant::Preview, String> {
    assistant::preview(change).await
}

/// Makes a change the assistant proposed. `expected` is the shard's text as
/// the editor shows it, when it's open there.
#[tauri::command]
pub(crate) async fn assistant_apply(
    change: String,
    expected: Option<String>,
) -> Result<assistant::Made, String> {
    assistant::apply(change, expected).await
}

#[tauri::command]
pub(crate) async fn assistant_undo(change: String) -> Result<assistant::Made, String> {
    assistant::undo(change).await
}

#[tauri::command]
pub(crate) async fn assistant_discard(change: String) -> Result<(), String> {
    assistant::discard(change).await
}

/// What the assistant remembers, for Settings.
#[tauri::command(async)]
pub(crate) fn assistant_memory() -> Result<assistant::Memory, String> {
    assistant::memory()
}

#[tauri::command(async)]
pub(crate) fn assistant_memory_edit(
    item: String,
    text: String,
) -> Result<assistant::Memory, String> {
    assistant::edit_memory(&item, &text)
}

#[tauri::command(async)]
pub(crate) fn assistant_memory_delete(item: String) -> Result<assistant::Memory, String> {
    assistant::delete_memory(&item)
}

#[tauri::command(async)]
pub(crate) fn assistant_memory_delete_all() -> Result<(), String> {
    assistant::delete_all_memory()
}

/// Adds an item the assistant offered to memory.
#[tauri::command]
pub(crate) async fn assistant_remember(offer: String) -> Result<(), String> {
    assistant::remember(offer).await
}

#[tauri::command]
pub(crate) async fn assistant_forget(offer: String) -> Result<(), String> {
    assistant::forget(offer).await
}

#[tauri::command]
pub(crate) async fn assistant_discard_offer(offer: String) -> Result<(), String> {
    assistant::discard_offer(offer).await
}
