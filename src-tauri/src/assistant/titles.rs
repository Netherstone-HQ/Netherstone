//! Chat titles: a short name for a new chat from its first question and
//! answer, with one small call to the model.

use super::chat::{self, ChatError, Message, Request, StopToken};
use super::engine::{self, Model};
use super::prompts::TITLE_PROMPT;
use super::runs::{open_vault, running};
use super::sessions;
use super::setup::picked_model;
use super::views::store;
use std::path::PathBuf;

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
    let title = short_title(&model, &chat, &question, &answer, stop).await?;
    let kept = title.clone();
    engine::saved(&store, move |store| store.set_title(&chat, &kept)).await?;
    Ok(sessions::title_of(&title))
}

/// The longest piece of the chat a title is made from.
const TITLE_PIECE: usize = 2_000;

/// A short name for a chat, from its first question and answer.
pub(super) async fn short_title(
    model: &Model,
    chat: &str,
    question: &str,
    answer: &str,
    stop: &StopToken,
) -> Result<String, ChatError> {
    let piece = |text: &str| -> String { text.chars().take(TITLE_PIECE).collect() };
    let messages = [Message::user(format!(
        "User: {}\n\nAssistant: {}",
        piece(question),
        piece(answer)
    ))];
    let request = Request {
        system: TITLE_PROMPT,
        messages: &messages,
        tools: &[],
        model: &model.id,
        thinking: None,
        cache_key: chat,
    };
    let reply = chat::stream(&model.target, &request, &mut |_| {}, stop).await?;
    clean_title(&reply.text).ok_or(ChatError::Failed)
}

/// A model's name for a chat as a title: its first line, without the
/// quotes, label or full stop models add anyway.
pub(super) fn clean_title(reply: &str) -> Option<String> {
    let line = reply.lines().map(str::trim).find(|line| !line.is_empty())?;
    let line = line
        .strip_prefix("Title:")
        .or_else(|| line.strip_prefix("Name:"))
        .unwrap_or(line);
    let quotes = |c: char| matches!(c, '"' | '\'' | '*' | '`' | '“' | '”' | '«' | '»');
    let stops = ['.', '。'];
    let title = line
        .trim()
        .trim_end_matches(stops)
        .trim_matches(quotes)
        .trim_end_matches(stops)
        .trim();
    (!title.is_empty()).then(|| title.to_string())
}
