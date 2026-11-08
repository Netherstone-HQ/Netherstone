//! Answers as they run: sending in a chat, inline Ask and chat titles, and
//! stopping them.

use super::chat::{self, ChatError, Message, StopToken};
use super::engine::{self, Event, Sink, Turn};
use super::providers::Api;
use super::setup::picked_model;
use super::views::store;
use super::{inline, local, memory};
use crate::ai_vaults::{self, Way};
use crate::db;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// The chats answering now: their window, and how to stop them.
pub(super) fn running() -> &'static Mutex<HashMap<String, (String, StopToken)>> {
    static RUNNING: std::sync::OnceLock<Mutex<HashMap<String, (String, StopToken)>>> =
        std::sync::OnceLock::new();
    RUNNING.get_or_init(Default::default)
}

/// The vault at `path`, while the assistant is on and may use it.
pub(super) fn open_vault(path: &std::path::Path) -> Result<crate::tools::Vault, ChatError> {
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
/// added to it, and streams the answer to `sink`. `recent` is the user's
/// Recent list, vault-relative. Gives the chat's id once the answer ends.
/// No text in a chat goes on with its last message's answer, after one that
/// ended on an error.
pub async fn send(
    chat: Option<String>,
    vault: String,
    text: String,
    shards: Vec<String>,
    recent: Vec<String>,
    window: String,
    sink: impl Sink + 'static,
) -> Result<String, ChatError> {
    let text = text.trim().to_string();
    // Going on with an answer adds nothing new to the chat.
    if text.is_empty() && (chat.is_none() || !shards.is_empty()) {
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
        recent,
        asked: Default::default(),
        step_limited: Default::default(),
        memory: Arc::new(memory::List::open().map_err(|error| {
            eprintln!("[Netherstone] {error}");
            ChatError::Storage
        })?),
    };
    let result = run(&turn, &text, &sink).await;
    if let Ok(mut running) = running().lock() {
        running.remove(&chat);
    }
    // Kept with the chat, so it still shows under its turn later.
    let asked = turn.asked.load(std::sync::atomic::Ordering::SeqCst);
    if asked > 0 {
        let ending = saved_ending(
            &result,
            turn.step_limited.load(std::sync::atomic::Ordering::SeqCst),
        );
        let id = chat.clone();
        if let Err(error) = engine::saved(&turn.store, move |store| {
            store.set_ending(&id, asked, ending.as_ref())
        })
        .await
        {
            eprintln!("[Netherstone] Couldn't keep how the answer ended: {error:?}");
        }
    }
    sink.send(Event::ending(result));
    Ok(chat)
}

/// How an answer ended, as the panel shows it, or None when it ended well.
fn saved_ending(
    result: &Result<(chat::Stop, chat::Usage), ChatError>,
    step_limited: bool,
) -> Option<serde_json::Value> {
    use serde_json::json;
    match result {
        Err(ChatError::Stopped) => Some(json!({ "kind": "stopped" })),
        Err(error) => {
            let kind = serde_json::to_value(error).ok()?.get("kind")?.clone();
            Some(json!({ "kind": "error", "error": kind }))
        }
        Ok((stop @ (chat::Stop::Length | chat::Stop::Filtered), _)) => {
            Some(json!({ "kind": "stop", "stop": stop }))
        }
        Ok(_) if step_limited => Some(json!({ "kind": "stepLimit" })),
        Ok(_) => None,
    }
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
    let asked = if text.is_empty() {
        engine::saved(&turn.store, move |store| {
            let messages = store.messages(&chat)?;
            // Only an answer that broke off goes on: a finished one ends on
            // a reply that calls no tools.
            if let Some(Message::Assistant { calls, .. }) = messages.last().map(|m| &m.message)
                && calls.is_empty()
            {
                return Err("The last answer is finished".to_string());
            }
            messages
                .into_iter()
                .rev()
                .find(|saved| matches!(saved.message, Message::User { .. }))
                .map(|saved| saved.seq)
                .ok_or_else(|| "The chat has no message to answer".to_string())
        })
        .await?
    } else {
        let (shards, files) = engine::attach(turn, &turn.added).await;
        let message = Message::User {
            text: text.to_string(),
            shards,
            files,
        };
        engine::saved(&turn.store, move |store| {
            store.add(&chat, &message, &[], None)
        })
        .await?
    };
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

pub(super) fn stop_all() {
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
