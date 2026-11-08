//! A chat's place in the model's context, and summaries of older messages
//! when it nears the limit.

use super::history::History;
use super::run::Out;
use super::{Event, Model, Turn, saved};
use crate::assistant::chat::{self, ChatError, Message, Request, ToolSpec};
use crate::assistant::prompts::SUMMARY_PROMPT;
use crate::assistant::providers::Api;
use crate::assistant::sessions::{Saved, Summary};

/// Tokens a model reads when the catalog doesn't say.
const UNKNOWN_CONTEXT: u64 = 32_000;
/// An Ollama model that isn't loaded yet: the smallest context Ollama picks
/// on its own, below 24 GiB of graphics memory (docs.ollama.com/context-length).
const UNKNOWN_LOCAL_CONTEXT: u64 = 4_096;
/// The share of what's left after the answer's room at which a chat is
/// summarized.
const SUMMARY_AT: f64 = 0.75;
/// The latest messages always sent as they are.
const KEEP_LATEST: usize = 4;

/// A rough count: about four characters a token.
fn estimate(text_len: usize) -> u64 {
    (text_len as u64).div_ceil(4)
}

fn context_of(model: &Model) -> (u64, u64) {
    let context = model.facts.context.unwrap_or(match model.target.api {
        Api::Ollama => UNKNOWN_LOCAL_CONTEXT,
        _ => UNKNOWN_CONTEXT,
    });
    let answer_room = model.facts.output.unwrap_or(4096).min(context / 4);
    (context, answer_room)
}

/// What every request sends whatever the chat holds: the system prompt and
/// the tools.
fn fixed_tokens(system: &str, specs: &[ToolSpec]) -> u64 {
    let tools: usize = specs
        .iter()
        .map(|spec| spec.name.len() + spec.description.len() + spec.schema.to_string().len())
        .sum();
    estimate(system.len() + tools)
}

/// Whether the model's context holds what every request sends and the
/// room for an answer. A context that isn't known is taken to.
pub(super) fn fits_context(model: &Model, system: &str, specs: &[ToolSpec]) -> bool {
    let (context, answer_room) = context_of(model);
    model.facts.context.is_none() || fixed_tokens(system, specs) + answer_room <= context
}

/// The rest of a request beside its fixed part: the summary and the
/// messages with their files.
fn chat_tokens(summary: Option<&Summary>, saved: &[Saved], bytes: u64) -> u64 {
    let files: u64 = saved
        .iter()
        .flat_map(|saved| saved.message.files())
        .map(|file| file.tokens)
        .sum();
    estimate(summary.map_or(0, |s| s.text.len()) + bytes as usize) + files
}

/// Where older messages end: before a user message, keeping the latest
/// ones, so a tool call never parts from its results.
pub(super) fn split_point(history: &[Saved]) -> Option<usize> {
    let last_allowed = history.len().checked_sub(KEEP_LATEST)?;
    (1..=last_allowed)
        .rev()
        .find(|&i| matches!(history[i].message, Message::User { .. }))
}

/// Summarizes older messages when the chat nears the model's limit, unless
/// what every request sends is over the limit already, so a summary would
/// free nothing that matters.
pub(super) async fn make_room(
    turn: &Turn,
    system: &str,
    specs: &[ToolSpec],
    history: &mut History,
    out: &mut Out<'_>,
) -> Result<(), ChatError> {
    let (context, answer_room) = context_of(&turn.model);
    let budget = ((context - answer_room) as f64 * SUMMARY_AT) as u64;
    let fixed = fixed_tokens(system, specs);
    let chat = chat_tokens(
        history.summary.as_ref(),
        &history.saved,
        history.message_bytes(),
    );
    if fixed + chat <= budget || fixed >= budget {
        return Ok(());
    }
    let Some(split) = split_point(&history.saved) else {
        return Ok(());
    };
    let through = history.saved[split - 1].seq;
    let text = summarize(turn, history.summary.as_ref(), &history.saved[..split]).await?;
    let summary = Summary { text, through };
    let chat = turn.chat.clone();
    let kept = summary.clone();
    saved(&turn.store, move |store| store.set_summary(&chat, &kept)).await?;
    history.summarized(summary, split);
    out.send(Event::Summarized);
    Ok(())
}

/// The longest a message's text gets in what's summarized.
const SUMMARY_PIECE: usize = 4_000;

async fn summarize(
    turn: &Turn,
    earlier: Option<&Summary>,
    messages: &[Saved],
) -> Result<String, ChatError> {
    let piece = |text: &str| -> String { text.chars().take(SUMMARY_PIECE).collect() };
    let mut transcript = String::new();
    if let Some(earlier) = earlier {
        transcript.push_str(&format!("Summary so far:\n{}\n\n", earlier.text));
    }
    for saved in messages {
        match &saved.message {
            Message::User { text, shards, .. } => {
                transcript.push_str(&format!("User: {}\n", piece(text)));
                for shard in shards {
                    transcript.push_str(&format!("Added {}: {}\n", shard.path, piece(&shard.text)));
                }
                transcript.push('\n');
            }
            Message::Assistant { text, calls, .. } => {
                if !text.is_empty() {
                    transcript.push_str(&format!("Assistant: {}\n\n", piece(text)));
                }
                for call in calls {
                    transcript.push_str(&format!(
                        "Assistant used {} with {}\n",
                        call.name, call.arguments
                    ));
                }
            }
            Message::Tool { results, .. } => {
                for result in results {
                    transcript.push_str(&format!(
                        "{} gave: {}\n\n",
                        result.name,
                        piece(&result.output)
                    ));
                }
            }
        }
    }
    let messages = [Message::user(transcript)];
    let request = Request {
        system: SUMMARY_PROMPT,
        messages: &messages,
        tools: &[],
        model: &turn.model.id,
        thinking: None,
        cache_key: &turn.chat,
    };
    let reply = chat::stream(&turn.model.target, &request, &mut |_| {}, &turn.stop).await?;
    match reply.text.trim() {
        "" => Err(ChatError::Failed),
        text => Ok(text.to_string()),
    }
}
