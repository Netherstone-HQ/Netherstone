//! Inline Ask: the user selects text in a shard and asks for a change to
//! it. One model call, without tools, whose answer is the Markdown that
//! replaces the selection. Nothing is saved: the app previews the answer
//! and writes it only on Apply, as an ordinary edit.

use super::chat::{self, Added, ChatError, Message, Request, Stop, StopToken, Usage};
use super::engine::{Model, Out, Sink};
use super::files;
use super::providers::Limits;
use crate::tools::Vault;
use std::sync::Arc;

/// What was asked about a selection.
pub struct Ask {
    pub vault: Arc<Vault>,
    pub model: Model,
    pub stop: StopToken,
    /// The send-images-and-PDFs switch.
    pub send_files: bool,
    /// The shard the selection is in, vault-relative.
    pub shard: String,
    /// The selection, as Markdown.
    pub selection: String,
    /// Whether the selection is whole blocks rather than part of one.
    pub whole: bool,
    pub prompt: String,
}

const SYSTEM: &str = "You are the assistant in Netherstone, an app where the user keeps \
shards (Markdown notes) in a vault. The user selected text in a shard and asked for a \
change to it. The shard comes inside <shard> tags and the selection inside <selection> \
tags. Reply with only the Markdown that replaces the selection: no quotes or code fence \
around it, and no words before or after it. Keep the selection's language and style \
unless asked otherwise. If the request is a question, reply with the selection rewritten \
to answer it.";

const PART: &str = " The selection is part of a paragraph: reply with text that fits in \
its place, without headings, lists or new paragraphs.";

const FILES_REFUSED: &str = " The provider turned down the shard's images and PDFs, so \
they aren't sent.";

/// Streams the replacement for the selection to `sink`.
pub async fn rewrite(ask: &Ask, sink: &dyn Sink) -> Result<(Stop, Usage), ChatError> {
    let mut system = SYSTEM.to_string();
    if !ask.whole {
        system.push_str(PART);
    }
    let mut messages = vec![message(ask).await];
    let mut out = Out::new(sink, &ask.stop);
    let mut result = stream(ask, &system, &messages, &mut out).await;
    // A provider may turn down a file: once more without them.
    if matches!(result, Err(ChatError::Failed | ChatError::TooLong))
        && files::any_sent(&messages)
        && out.step_text.is_empty()
    {
        files::without_data(&mut messages);
        system.push_str(FILES_REFUSED);
        result = stream(ask, &system, &messages, &mut out).await;
    }
    out.flush();
    let reply = result?;
    Ok((reply.stop, reply.usage))
}

async fn stream(
    ask: &Ask,
    system: &str,
    messages: &[Message],
    out: &mut Out<'_>,
) -> Result<chat::Reply, ChatError> {
    let request = Request {
        system,
        messages,
        tools: &[],
        model: &ask.model.id,
        thinking: ask.model.facts.reasoning,
        cache_key: &ask.shard,
    };
    chat::stream(
        &ask.model.target,
        &request,
        &mut |delta| out.delta(delta),
        &ask.stop,
    )
    .await
}

/// The question, with the shard as it is on disk and its images and PDFs
/// when the switch lets them go.
async fn message(ask: &Ask) -> Message {
    let text = format!(
        "<selection>\n{}\n</selection>\n\n{}",
        ask.selection.trim_end(),
        ask.prompt.trim()
    );
    let vault = ask.vault.clone();
    let shard = ask.shard.clone();
    let sending = files::Sending::new(ask.send_files, ask.model.target.api, &ask.model.facts);
    let api = ask.model.target.api;
    let send_files = ask.send_files;
    let text_bytes = (SYSTEM.len() + text.len()) as u64;
    let plain = Message::user(text.clone());
    tauri::async_runtime::spawn_blocking(move || {
        let markdown = vault
            .resolve(&shard)
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok());
        let Some(markdown) = markdown else {
            return Message::user(text);
        };
        let (found, _) = files::choose(&vault.root, &shard, files::in_shard(&markdown), &sending);
        let bytes = text_bytes + markdown.len() as u64;
        let mut message = Message::User {
            text,
            shards: vec![Added {
                path: shard,
                text: markdown,
            }],
            files: found,
        };
        if send_files {
            files::load(
                &vault.root,
                std::slice::from_mut(&mut message),
                &Limits::of(api),
                bytes,
            );
        }
        message
    })
    .await
    .unwrap_or(plain)
}

#[cfg(test)]
mod tests;
