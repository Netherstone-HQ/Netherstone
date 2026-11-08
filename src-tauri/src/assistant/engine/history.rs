//! The chat as the model gets it through one answer.

use super::{SharedStore, saved};
use crate::assistant::chat::{Call, CallResult, ChatError, Message};
use crate::assistant::sessions::{Saved, Summary};

/// The chat as the model gets it, through one answer: read once, then each
/// message added as it's saved, with its size kept as it goes.
pub(super) struct History {
    pub(super) summary: Option<Summary>,
    /// The messages after the summary.
    pub(super) saved: Vec<Saved>,
    /// The size of each of them as JSON.
    sizes: Vec<usize>,
}

fn json_size(message: &Message) -> usize {
    serde_json::to_string(message).map_or(0, |json| json.len())
}

impl History {
    fn new(summary: Option<Summary>, saved: Vec<Saved>) -> Self {
        let sizes = saved
            .iter()
            .map(|saved| json_size(&saved.message))
            .collect();
        Self {
            summary,
            saved,
            sizes,
        }
    }

    pub(super) fn push(&mut self, seq: i64, message: Message) {
        self.sizes.push(json_size(&message));
        self.saved.push(Saved {
            seq,
            message,
            sources: Vec::new(),
            model: None,
        });
    }

    pub(super) fn message_bytes(&self) -> u64 {
        self.sizes.iter().sum::<usize>() as u64
    }

    /// The messages to send, every tool call answered.
    pub(super) fn messages(&self) -> Vec<Message> {
        answered(without_unanswered(
            self.saved
                .iter()
                .map(|saved| saved.message.clone())
                .collect(),
        ))
    }

    /// `summary` now stands in for the messages before `split`.
    pub(super) fn summarized(&mut self, summary: Summary, split: usize) {
        self.summary = Some(summary);
        self.saved.drain(..split);
        self.sizes.drain(..split);
    }
}

pub(super) async fn load(store: &SharedStore, chat: &str) -> Result<History, ChatError> {
    let chat = chat.to_string();
    saved(store, move |store| {
        let summary = store.summary(&chat)?;
        let through = summary.as_ref().map_or(0, |s| s.through);
        let messages = store
            .messages(&chat)?
            .into_iter()
            .filter(|saved| saved.seq > through)
            .collect();
        Ok(History::new(summary, messages))
    })
    .await
}

/// `messages` without questions that never got an answer, as when one
/// failed and another was asked after it: they'd reach the model as user
/// turns in a row.
pub(super) fn without_unanswered(messages: Vec<Message>) -> Vec<Message> {
    let is_user = |message: Option<&Message>| matches!(message, Some(Message::User { .. }));
    let mut kept = Vec::with_capacity(messages.len());
    let mut rest = messages.into_iter().peekable();
    while let Some(message) = rest.next() {
        if is_user(Some(&message)) && is_user(rest.peek()) {
            continue;
        }
        kept.push(message);
    }
    kept
}

/// `messages` with every tool call answered: a call whose result was
/// never saved, as when the app quit while a tool ran, gets a "not run"
/// one, so providers take the chat.
pub(super) fn answered(messages: Vec<Message>) -> Vec<Message> {
    fn not_run(calls: Vec<Call>) -> impl Iterator<Item = CallResult> {
        calls.into_iter().map(|call| CallResult {
            id: call.id,
            name: call.name,
            output: "Not run.".to_string(),
        })
    }
    let mut out: Vec<Message> = Vec::with_capacity(messages.len());
    let mut open: Vec<Call> = Vec::new();
    for mut message in messages {
        if let Message::Tool { results, .. } = &mut message {
            open.retain(|call| results.iter().all(|result| result.id != call.id));
            results.extend(not_run(std::mem::take(&mut open)));
        } else if !open.is_empty() {
            out.push(Message::Tool {
                results: not_run(std::mem::take(&mut open)).collect(),
                files: Vec::new(),
            });
        }
        if let Message::Assistant { calls, .. } = &message {
            open = calls.clone();
        }
        out.push(message);
    }
    if !open.is_empty() {
        out.push(Message::Tool {
            results: not_run(open).collect(),
            files: Vec::new(),
        });
    }
    out
}
