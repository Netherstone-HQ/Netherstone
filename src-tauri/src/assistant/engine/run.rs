//! One answer: each step streams the model's reply, runs its tool calls
//! and goes again, within the step limit.

use super::context::{fits_context, make_room};
use super::history::{History, load};
use super::tools::{run_calls, specs, tools};
use super::{Event, Sink, Turn, saved};
use crate::assistant::chat::{
    self, ChatError, Delta, Message, Request, Stop, StopToken, ToolSpec, Usage,
};
use crate::assistant::files;
use crate::assistant::prompts::{FILES_REFUSED, change_states, system_prompt, with_summary};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Model calls in one answer, tool rounds included.
pub const MAX_STEPS: usize = 12;
/// Text is sent in small batches rather than token by token.
const BATCH_BYTES: usize = 256;
const BATCH_WAIT: Duration = Duration::from_millis(50);

/// Batches streamed text into events, and stops the chat when nobody's
/// listening anymore.
pub(in crate::assistant) struct Out<'a> {
    sink: &'a dyn Sink,
    stop: &'a StopToken,
    text: String,
    reasoning: String,
    /// When text was last sent. None at the start of a step, so its first
    /// words show at once instead of waiting for the next ones.
    last: Option<Instant>,
    /// All the text of the step streaming now.
    pub(in crate::assistant) step_text: String,
}

impl<'a> Out<'a> {
    pub(in crate::assistant) fn new(sink: &'a dyn Sink, stop: &'a StopToken) -> Self {
        Self {
            sink,
            stop,
            text: String::new(),
            reasoning: String::new(),
            last: None,
            step_text: String::new(),
        }
    }

    pub(super) fn send(&self, event: Event) {
        if !self.sink.send(event) {
            self.stop.stop();
        }
    }

    pub(in crate::assistant) fn delta(&mut self, delta: Delta) {
        match delta {
            Delta::Text(text) => {
                self.text.push_str(text);
                self.step_text.push_str(text);
            }
            Delta::Reasoning(text) => self.reasoning.push_str(text),
            Delta::Retrying(error) => {
                self.send(Event::Retrying { error });
                return;
            }
        }
        if self.text.len() + self.reasoning.len() >= BATCH_BYTES
            || self.last.is_none_or(|last| last.elapsed() >= BATCH_WAIT)
        {
            self.flush();
        }
    }

    /// A new step: its first words show at once.
    fn start_step(&mut self) {
        self.step_text.clear();
        self.last = None;
    }

    pub(in crate::assistant) fn flush(&mut self) {
        self.last = Some(Instant::now());
        if !self.reasoning.is_empty() {
            let text = std::mem::take(&mut self.reasoning);
            self.send(Event::Reasoning { text });
        }
        if !self.text.is_empty() {
            let text = std::mem::take(&mut self.text);
            self.send(Event::Text { text });
        }
    }
}

pub async fn answer(turn: &Turn, sink: &dyn Sink) -> Result<(Stop, Usage), ChatError> {
    let tools = Arc::new(tools());
    let specs = specs(&tools);
    let vault_name = turn
        .vault
        .root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    // Read for each message, so an edit in Settings counts from the next.
    let list = turn.memory.clone();
    // A list that can't be read leaves memory out rather than the answer.
    let remembered = tauri::async_runtime::spawn_blocking(move || list.for_chat())
        .await
        .map_err(|_| ChatError::Storage)?
        .unwrap_or_else(|error| {
            eprintln!("[Netherstone] {error}");
            Vec::new()
        });
    let chat = turn.chat.clone();
    let changes = saved(&turn.store, move |store| store.changes(&chat)).await?;
    let mut system = system_prompt(&vault_name, &remembered);
    system.push_str(&change_states(&changes, turn.asked.load(Ordering::SeqCst)));
    let mut out = Out::new(sink, &turn.stop);
    let mut sources: Vec<String> = turn.added.clone();
    if !sources.is_empty() {
        out.send(Event::Sources {
            shards: sources.clone(),
        });
    }
    let mut usage = Usage::default();
    let chat_id = turn.chat.clone();
    if !fits_context(&turn.model, &system, &specs) {
        return Err(ChatError::ContextTooSmall);
    }
    let mut history = load(&turn.store, &chat_id).await?;
    let encoded = Arc::new(Mutex::new(files::Encoded::default()));

    for step in 0..MAX_STEPS {
        if turn.stop.is_stopped() {
            return Err(ChatError::Stopped);
        }
        make_room(turn, &system, &specs, &mut history, &mut out).await?;
        let mut system = with_summary(&system, history.summary.as_ref());
        let mut messages = with_files(turn, &history, system.len() as u64, &encoded).await;

        out.start_step();
        let mut result = stream_step(turn, &system, &messages, &specs, &mut out).await;
        // A provider may turn down a file, like a PDF with too many pages:
        // the step goes again without them, and the model is told.
        if matches!(result, Err(ChatError::Failed | ChatError::TooLong))
            && files::any_sent(&messages)
            && out.step_text.is_empty()
        {
            files::without_data(&mut messages);
            system.push_str(FILES_REFUSED);
            result = stream_step(turn, &system, &messages, &specs, &mut out).await;
        }
        out.flush();
        let reply = match result {
            Ok(reply) => reply,
            Err(error) => {
                // What streamed before a stop stays in the chat.
                if error == ChatError::Stopped {
                    keep_partial(turn, std::mem::take(&mut out.step_text)).await?;
                }
                return Err(error);
            }
        };
        usage.input += reply.usage.input;
        usage.output += reply.usage.output;

        let calls = reply.calls.clone();
        let done = calls.is_empty();
        // An empty answer isn't kept: providers refuse empty messages.
        if done && reply.text.is_empty() {
            return Ok((reply.stop, usage));
        }
        let message = Message::Assistant {
            text: reply.text.clone(),
            calls: reply.calls,
            reasoning: reply.reasoning,
        };
        let cited = if done { sources.clone() } else { Vec::new() };
        let model = turn.model.id.clone();
        let chat = chat_id.clone();
        let kept = message.clone();
        let seq = saved(&turn.store, move |store| {
            store.add(&chat, &kept, &cited, Some(&model))
        })
        .await?;
        history.push(seq, message);
        if done {
            return Ok((reply.stop, usage));
        }

        // Past the limit, the calls are answered as not run, so the chat
        // stays one a provider takes.
        let over = step + 1 == MAX_STEPS;
        let allowed = turn.allowed.clone();
        if !tauri::async_runtime::spawn_blocking(move || allowed())
            .await
            .unwrap_or(false)
        {
            return Err(ChatError::VaultClosed);
        }
        let (results, files) = run_calls(turn, &tools, &calls, over, &mut out, &mut sources).await;
        let chat = chat_id.clone();
        let message = Message::Tool { results, files };
        let kept = message.clone();
        let seq = saved(&turn.store, move |store| store.add(&chat, &kept, &[], None)).await?;
        history.push(seq, message);
        if over {
            turn.step_limited.store(true, Ordering::SeqCst);
            out.send(Event::StepLimit);
            return Ok((Stop::Done, usage));
        }
    }
    Ok((Stop::Done, usage))
}

async fn stream_step(
    turn: &Turn,
    system: &str,
    messages: &[Message],
    specs: &[ToolSpec],
    out: &mut Out<'_>,
) -> Result<chat::Reply, ChatError> {
    let request = Request {
        system,
        messages,
        tools: specs,
        model: &turn.model.id,
        thinking: turn.model.facts.reasoning,
        cache_key: &turn.chat,
    };
    chat::stream(
        &turn.model.target,
        &request,
        &mut |delta| out.delta(delta),
        &turn.stop,
    )
    .await
}

/// The chat's messages for the next request, with their files' data read
/// off the async threads.
async fn with_files(
    turn: &Turn,
    history: &History,
    system_bytes: u64,
    encoded: &Arc<Mutex<files::Encoded>>,
) -> Vec<Message> {
    let mut messages = history.messages();
    let has_files = messages.iter().any(|m| !m.files().is_empty());
    if !turn.send_files || !has_files {
        return messages;
    }
    let root = turn.vault.root.clone();
    let sending = files::Sending::new(turn.send_files, turn.model.target.api, &turn.model.facts);
    let text_bytes = system_bytes + history.message_bytes();
    let encoded = encoded.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut encoded = encoded.lock().unwrap_or_else(|e| e.into_inner());
        files::load(&root, &mut messages, &sending, text_bytes, &mut encoded);
        messages
    })
    .await
    .ok()
    // Without its files rather than without the chat.
    .unwrap_or_else(|| history.messages())
}

/// Saves what streamed of an answer that was stopped.
async fn keep_partial(turn: &Turn, text: String) -> Result<(), ChatError> {
    if text.trim().is_empty() {
        return Ok(());
    }
    let chat = turn.chat.clone();
    let model = turn.model.id.clone();
    saved(&turn.store, move |store| {
        let message = Message::Assistant {
            text,
            calls: Vec::new(),
            reasoning: None,
        };
        store.add(&chat, &message, &[], Some(&model)).map(|_| ())
    })
    .await
}
