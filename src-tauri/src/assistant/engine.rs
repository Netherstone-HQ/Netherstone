//! The assistant's loop: send the chat, stream the answer, run the vault
//! tools the model calls, and go again until it answers, within a step
//! limit. Read tools run; write tools only propose their change, which the
//! user applies or discards (`tools::proposals`), checked here and not
//! left to the model. Shards it reads are the answer's sources. A chat
//! that grows near the model's limit has its older messages summarized
//! first.

use super::catalog::Facts;
use super::chat::{
    self, Added, Call, CallResult, ChatError, Delta, File, Message, Request, Stop, StopToken,
    ToolSpec, Usage,
};
use super::files;
use super::memory::{self, List};
use super::models::Target;
use super::providers::{Api, Limits};
use super::sessions::ChangeState;
use super::sessions::{Saved, Store, Summary};
use crate::tools::proposals::{self, Op, WRITE_TOOLS};
use crate::tools::{self, Caller, Tool, Vault};
use serde::Serialize;
use serde_json::Value;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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

/// Model calls in one answer, tool rounds included.
pub const MAX_STEPS: usize = 12;
/// A tool's output longer than this is cut, so one read can't fill the chat.
const MAX_TOOL_OUTPUT: usize = 60_000;
/// Text is sent in small batches rather than token by token.
const BATCH_BYTES: usize = 256;
const BATCH_WAIT: Duration = Duration::from_millis(50);

/// The tools the assistant runs as they are.
const READ_TOOLS: [&str; 7] = [
    "search",
    "list_folder",
    "read",
    "links",
    "list_tags",
    "read_drawing",
    "vault_overview",
];

fn is_read_tool(name: &str) -> bool {
    READ_TOOLS.contains(&name)
}

fn is_write_tool(name: &str) -> bool {
    WRITE_TOOLS.contains(&name)
}

pub fn tools() -> Vec<Tool> {
    tools::all()
        .into_iter()
        .filter(|tool| {
            (tool.read_only && is_read_tool(tool.name))
                || (!tool.read_only && is_write_tool(tool.name))
        })
        .collect()
}

/// The tool the assistant offers a memory item with. It's the app's own,
/// not one of the vault tools AI apps share.
const REMEMBER: &str = "remember";

fn remember_spec() -> ToolSpec {
    ToolSpec {
        name: REMEMBER.to_string(),
        description: format!(
            "Offers to add one item to the user's memory: a short list of things about \
the user and how they want answers, sent with every chat. Nothing is added until the \
user applies it. Offer only something lasting the user said about themselves or asked \
for, never facts from their shards and never what's in memory already. One item a \
call, at most {} characters.",
            memory::MAX_LENGTH
        ),
        schema: serde_json::json!({
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The item, one short line about the user, like \"I write in British English\""
                }
            },
            "required": ["text"]
        }),
    }
}

fn specs(tools: &[Tool]) -> Vec<ToolSpec> {
    tools
        .iter()
        .map(|tool| ToolSpec {
            name: tool.name.to_string(),
            description: tool.description.clone(),
            schema: Value::Object(tool.input_schema.clone()),
        })
        .chain([remember_spec()])
        .collect()
}

fn system_prompt(vault: &str, remembered: &[String]) -> String {
    let mut prompt = format!(
        "You are the assistant in Netherstone, an app where the user keeps shards \
(Markdown notes) in a vault, a folder on their computer. This chat is about the vault \
\"{vault}\". Answer from the vault: search and read shards with the tools before \
answering about the user's notes, and never guess what they say. Cite the shards you \
used with a Markdown link to the shard's vault path right after what it backs, like \
[Trip plan](Travel/Trip%20plan.md), or [Trip plan](Travel/Trip%20plan.md#Day%202) for one \
section. The app shows each cite as a number, so never use one as a word in a sentence. Shards the user adds to a \
message come with it inside <shard> tags. Changes you make with the write tools aren't made right away: the user \
sees each one in the app and applies or discards it, so say in your answer what you changed, and give each \
change a summary. Reading a shard shows it as it is, without changes not applied yet. Reply in \
the language the user writes in, and keep answers short unless asked for more. Today \
is {}. To remember something about the user for later chats, offer it with the remember \
tool: the user adds it to memory or not.",
        chrono::Local::now().format("%Y-%m-%d")
    );
    if !remembered.is_empty() {
        prompt.push_str("\n\nWhat the user asked you to remember about them:");
        for item in remembered {
            prompt.push_str("\n- ");
            prompt.push_str(item);
        }
    }
    prompt
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
    /// What the user asked the assistant to remember.
    pub memory: Arc<List>,
}

/// Batches streamed text into events, and stops the chat when nobody's
/// listening anymore.
struct Out<'a> {
    sink: &'a dyn Sink,
    stop: &'a StopToken,
    text: String,
    reasoning: String,
    /// When text was last sent. None at the start of a step, so its first
    /// words show at once instead of waiting for the next ones.
    last: Option<Instant>,
    /// All the text of the step streaming now.
    step_text: String,
}

impl<'a> Out<'a> {
    fn new(sink: &'a dyn Sink, stop: &'a StopToken) -> Self {
        Self {
            sink,
            stop,
            text: String::new(),
            reasoning: String::new(),
            last: None,
            step_text: String::new(),
        }
    }

    fn send(&self, event: Event) {
        if !self.sink.send(event) {
            self.stop.stop();
        }
    }

    fn delta(&mut self, delta: Delta) {
        match delta {
            Delta::Text(text) => {
                self.text.push_str(text);
                self.step_text.push_str(text);
            }
            Delta::Reasoning(text) => self.reasoning.push_str(text),
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

    fn flush(&mut self) {
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
    let system = system_prompt(&vault_name, &remembered);
    let mut out = Out::new(sink, &turn.stop);
    let mut sources: Vec<String> = turn.added.clone();
    if !sources.is_empty() {
        out.send(Event::Sources {
            shards: sources.clone(),
        });
    }
    let mut usage = Usage::default();
    let chat_id = turn.chat.clone();

    for step in 0..MAX_STEPS {
        if turn.stop.is_stopped() {
            return Err(ChatError::Stopped);
        }
        let (summary, history) = load(&turn.store, &chat_id).await?;
        let (summary, history) =
            match make_room(turn, &system, &specs, summary, history, &mut out).await? {
                Some(room) => room,
                None => load(&turn.store, &chat_id).await?,
            };
        let mut system = with_summary(&system, summary.as_ref());
        let mut messages = with_files(
            turn,
            answered(history.into_iter().map(|saved| saved.message).collect()),
            system.len() as u64,
        )
        .await;

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
        saved(&turn.store, move |store| {
            store.add(&chat, &message, &cited, Some(&model)).map(|_| ())
        })
        .await?;
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
        saved(&turn.store, move |store| {
            store.add(&chat, &message, &[], None).map(|_| ())
        })
        .await?;
        if over {
            out.send(Event::StepLimit);
            return Ok((Stop::Done, usage));
        }
    }
    Ok((Stop::Done, usage))
}

const FILES_REFUSED: &str = "\n\nThe provider turned down the images and PDFs of \
this chat, so they weren't sent this time. If the answer needs them, tell the user.";

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

/// `messages` with their files' data read, off the async threads.
async fn with_files(turn: &Turn, mut messages: Vec<Message>, system_bytes: u64) -> Vec<Message> {
    let has_files = messages.iter().any(|m| !m.files().is_empty());
    if !turn.send_files || !has_files {
        return messages;
    }
    let root = turn.vault.root.clone();
    let limits = Limits::of(turn.model.target.api);
    let text_bytes = system_bytes
        + messages
            .iter()
            .map(|m| serde_json::to_string(m).map_or(0, |json| json.len() as u64))
            .sum::<u64>();
    let plain = messages.clone();
    tauri::async_runtime::spawn_blocking(move || {
        files::load(&root, &mut messages, &limits, text_bytes);
        messages
    })
    .await
    // Without its files rather than without the chat.
    .unwrap_or(plain)
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

async fn run_calls(
    turn: &Turn,
    tools: &Arc<Vec<Tool>>,
    calls: &[Call],
    over: bool,
    out: &mut Out<'_>,
    sources: &mut Vec<String>,
) -> (Vec<CallResult>, Vec<File>) {
    let mut results = Vec::new();
    let mut files: Vec<File> = Vec::new();
    for call in calls {
        let output = if over {
            "Not run: the answer reached its step limit.".to_string()
        } else if turn.stop.is_stopped() {
            "Not run: the user stopped the answer.".to_string()
        } else {
            out.send(Event::Tool {
                name: call.name.clone(),
                paths: paths_in(&call.arguments),
            });
            match run_tool(turn, tools, call).await {
                Ok(mut output) => {
                    if matches!(call.name.as_str(), "read" | "read_drawing") {
                        let before = sources.len();
                        for path in paths_in(&call.arguments) {
                            if !sources.contains(&path) {
                                sources.push(path);
                            }
                        }
                        if sources.len() > before {
                            out.send(Event::Sources {
                                shards: sources.clone(),
                            });
                        }
                    }
                    if call.name == "read" {
                        let (found, note) = shard_files(turn, &call.arguments).await;
                        for file in found {
                            if !files.iter().any(|f| f.path == file.path) {
                                files.push(file);
                            }
                        }
                        if let Some(note) = note {
                            output.push_str("\n\n");
                            output.push_str(&note);
                        }
                    }
                    output
                }
                Err(error) => format!("Error: {error}"),
            }
        };
        results.push(CallResult {
            id: call.id.clone(),
            name: call.name.clone(),
            output,
        });
    }
    (results, files)
}

/// The shards added to a message, read now, with their images and PDFs.
/// A shard that can't be read says so in its text.
pub async fn attach(turn: &Turn, shards: &[String]) -> (Vec<Added>, Vec<File>) {
    let tools = Arc::new(tools());
    let mut added = Vec::new();
    let mut files: Vec<File> = Vec::new();
    for path in shards {
        let arguments = serde_json::json!({ "path": path });
        let is_drawing = path.to_ascii_lowercase().ends_with(".excalidraw");
        let call = Call {
            id: String::new(),
            name: if is_drawing { "read_drawing" } else { "read" }.to_string(),
            arguments: arguments.clone(),
            signatures: Vec::new(),
        };
        let mut text = match run_tool(turn, &tools, &call).await {
            Ok(text) => text,
            Err(error) => format!("Error: {error}"),
        };
        let (found, note) = if is_drawing {
            (Vec::new(), None)
        } else {
            shard_files(turn, &arguments).await
        };
        for file in found {
            if !files.iter().any(|f| f.path == file.path) {
                files.push(file);
            }
        }
        if let Some(note) = note {
            text.push_str("\n\n");
            text.push_str(&note.replace("the next message", "this message"));
        }
        added.push(Added {
            path: path.clone(),
            text,
        });
    }
    (added, files)
}

/// The images, drawings and PDFs of the shards a read named that go to the
/// model, and what the model is told about them.
async fn shard_files(turn: &Turn, arguments: &Value) -> (Vec<File>, Option<String>) {
    let vault = turn.vault.clone();
    let shards = paths_in(arguments);
    let sending = files::Sending::new(turn.send_files, turn.model.target.api, &turn.model.facts);
    tauri::async_runtime::spawn_blocking(move || {
        let mut sent = Vec::new();
        let mut notes = Vec::new();
        for shard in shards {
            let Ok(path) = vault.resolve(&shard) else {
                continue;
            };
            let Ok(markdown) = std::fs::read_to_string(&path) else {
                continue;
            };
            let (found, note) =
                files::choose(&vault.root, &shard, files::in_shard(&markdown), &sending);
            sent.extend(found);
            notes.extend(note);
        }
        (sent, (!notes.is_empty()).then(|| notes.join("\n")))
    })
    .await
    .unwrap_or_default()
}

/// The paths a call names.
fn paths_in(arguments: &Value) -> Vec<String> {
    let mut paths: Vec<String> = Vec::new();
    for key in ["path", "folder"] {
        if let Some(path) = arguments.get(key).and_then(Value::as_str) {
            paths.push(path.to_string());
        }
    }
    if let Some(list) = arguments.get("paths").and_then(Value::as_array) {
        paths.extend(list.iter().filter_map(Value::as_str).map(str::to_string));
    }
    paths
}

async fn run_tool(turn: &Turn, tools: &Arc<Vec<Tool>>, call: &Call) -> Result<String, String> {
    if call.name == REMEMBER {
        return offer(turn, call).await;
    }
    // The model only gets these tools, but it may name any.
    if !tools.iter().any(|t| t.name == call.name) {
        return Err(format!("There's no tool called {}", call.name));
    }
    if is_write_tool(&call.name) {
        return propose(turn, call).await;
    }
    if !is_read_tool(&call.name) {
        return Err(format!("There's no tool called {}", call.name));
    }
    let tools = tools.clone();
    let vault = turn.vault.clone();
    let name = call.name.clone();
    let arguments = call.arguments.clone();
    let value = tauri::async_runtime::spawn_blocking(move || {
        let tool = tools
            .iter()
            .find(|tool| tool.name == name)
            .ok_or_else(|| "There's no such tool".to_string())?;
        let caller = Caller {
            app: "Assistant".to_string(),
        };
        tool.call(&vault, &caller, arguments)
            .map_err(|error| error.0)
    })
    .await
    .map_err(|_| "The tool stopped".to_string())??;
    let mut text = serde_json::to_string(&value).map_err(|e| e.to_string())?;
    if text.len() > MAX_TOOL_OUTPUT {
        let mut end = MAX_TOOL_OUTPUT;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
        text.push_str("… [cut: ask for less, like one section or a smaller page]");
    }
    Ok(text)
}

/// Keeps a write tool's call as a proposed change, with the change made so
/// far to the same file in this answer, once it's checked to fit. Nothing
/// is written.
async fn propose(turn: &Turn, call: &Call) -> Result<String, String> {
    let vault = turn.vault.clone();
    let store = turn.store.clone();
    let chat = turn.chat.clone();
    let stop = turn.stop.clone();
    let asked = turn.asked.load(Ordering::SeqCst);
    let model = turn
        .model
        .facts
        .name
        .clone()
        .unwrap_or_else(|| turn.model.id.clone());
    let op = Op {
        name: call.name.clone(),
        arguments: call.arguments.clone(),
    };
    tauri::async_runtime::spawn_blocking(move || {
        let next = proposals::target(&vault, &op).map_err(|error| error.0)?;
        let store = store
            .lock()
            .map_err(|_| "Saved chats are locked".to_string())?;
        // Turning the assistant off stops the answer, then drops what's
        // pending under this lock: a stopped answer adds nothing after it.
        if stop.is_stopped() {
            return Err("The answer was stopped".to_string());
        }
        let earlier = store.changes(&chat)?.into_iter().find(|change| {
            change.turn == asked
                && change.state == ChangeState::Pending
                && proposals::adds_to(
                    &proposals::Target {
                        kind: change.kind,
                        path: change.path.clone(),
                    },
                    &next,
                )
        });
        let (target, mut ops) = match &earlier {
            Some(change) => (
                proposals::Target {
                    kind: change.kind,
                    path: change.path.clone(),
                },
                change.ops.clone(),
            ),
            None => (next, Vec::new()),
        };
        ops.push(op);
        if target.kind != proposals::Kind::Move {
            proposals::replay(&vault, proposals::current(&vault, &target), &ops)
                .map_err(|error| error.0)?;
        }
        match &earlier {
            Some(change) => store.set_ops(&change.id, &ops)?,
            None => {
                store.add_change(&chat, asked, target.kind, &target.path, &ops, Some(&model))?;
            }
        }
        Ok(format!(
            "Proposed, not made yet: the user sees this change to {} and applies or discards it.",
            target.path
        ))
    })
    .await
    .map_err(|_| "The tool stopped".to_string())?
}

/// Keeps a memory item the model offers, for the user to add or not, once
/// it fits the list. Nothing is added.
async fn offer(turn: &Turn, call: &Call) -> Result<String, String> {
    let text = call
        .arguments
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let list = turn.memory.clone();
    let store = turn.store.clone();
    let chat = turn.chat.clone();
    let stop = turn.stop.clone();
    let asked = turn.asked.load(Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        let item = memory::clean(&text)?;
        let items = list.items()?;
        if memory::holds(&items, &item) {
            return Ok("That's in memory already, so nothing was offered.".to_string());
        }
        let store = store
            .lock()
            .map_err(|_| "Saved chats are locked".to_string())?;
        // As for changes: a stopped answer offers nothing after it.
        if stop.is_stopped() {
            return Err("The answer was stopped".to_string());
        }
        let pending: Vec<_> = store
            .offers(&chat)?
            .into_iter()
            .filter(|offer| offer.turn == asked && offer.state == ChangeState::Pending)
            .collect();
        if pending.iter().any(|offer| memory::same(&offer.text, &item)) {
            return Ok("Offered already.".to_string());
        }
        if items.len() + pending.len() >= memory::MAX_ITEMS {
            return Err(format!(
                "Memory is full, it holds {} items. Nothing was offered. The user can delete items in Settings.",
                memory::MAX_ITEMS
            ));
        }
        store.add_offer(&chat, asked, &item)?;
        Ok("Offered, not added yet: the user sees it and adds it to memory or discards it.".to_string())
    })
    .await
    .map_err(|_| "The tool stopped".to_string())?
}

async fn load(store: &SharedStore, chat: &str) -> Result<(Option<Summary>, Vec<Saved>), ChatError> {
    let chat = chat.to_string();
    saved(store, move |store| {
        let summary = store.summary(&chat)?;
        let through = summary.as_ref().map_or(0, |s| s.through);
        let messages = store
            .messages(&chat)?
            .into_iter()
            .filter(|saved| saved.seq > through)
            .collect();
        Ok((summary, messages))
    })
    .await
}

/// `messages` with every tool call answered: a call whose result was
/// never saved, as when the app quit while a tool ran, gets a "not run"
/// one, so providers take the chat.
fn answered(messages: Vec<Message>) -> Vec<Message> {
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

fn with_summary(system: &str, summary: Option<&Summary>) -> String {
    match summary {
        Some(summary) => format!(
            "{system}\n\nEarlier messages of this chat, summarized:\n{}",
            summary.text
        ),
        None => system.to_string(),
    }
}

// ── Long chats ───────────────────────────────────────────────────────────────

/// Tokens a model reads when the catalog doesn't say.
const UNKNOWN_CONTEXT: u64 = 32_000;
/// A server on this computer that doesn't say: Ollama's usual size.
const UNKNOWN_LOCAL_CONTEXT: u64 = 8_192;
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

fn tokens_of(
    system: &str,
    specs: &[ToolSpec],
    summary: Option<&Summary>,
    history: &[Saved],
) -> u64 {
    let tools: usize = specs
        .iter()
        .map(|spec| spec.name.len() + spec.description.len() + spec.schema.to_string().len())
        .sum();
    let messages: usize = history
        .iter()
        .map(|saved| serde_json::to_string(&saved.message).map_or(0, |json| json.len()))
        .sum();
    let files: u64 = history
        .iter()
        .flat_map(|saved| saved.message.files())
        .map(|file| file.tokens)
        .sum();
    estimate(system.len() + tools + summary.map_or(0, |s| s.text.len()) + messages) + files
}

/// Where older messages end: before a user message, keeping the latest
/// ones, so a tool call never parts from its results.
fn split_point(history: &[Saved]) -> Option<usize> {
    let last_allowed = history.len().checked_sub(KEEP_LATEST)?;
    (1..=last_allowed)
        .rev()
        .find(|&i| matches!(history[i].message, Message::User { .. }))
}

/// Summarizes older messages when the chat nears the model's limit. Gives
/// the chat as it now stands when it did.
async fn make_room(
    turn: &Turn,
    system: &str,
    specs: &[ToolSpec],
    summary: Option<Summary>,
    history: Vec<Saved>,
    out: &mut Out<'_>,
) -> Result<Option<(Option<Summary>, Vec<Saved>)>, ChatError> {
    let (context, answer_room) = context_of(&turn.model);
    let budget = ((context - answer_room) as f64 * SUMMARY_AT) as u64;
    if tokens_of(system, specs, summary.as_ref(), &history) <= budget {
        return Ok(Some((summary, history)));
    }
    let Some(split) = split_point(&history) else {
        return Ok(Some((summary, history)));
    };
    let through = history[split - 1].seq;
    let text = summarize(turn, summary.as_ref(), &history[..split]).await?;
    let summary = Summary { text, through };
    let chat = turn.chat.clone();
    let kept = summary.clone();
    saved(&turn.store, move |store| store.set_summary(&chat, &kept)).await?;
    out.send(Event::Summarized);
    Ok(None)
}

const SUMMARY_PROMPT: &str = "You summarize a chat between a user and the assistant \
of their notes app so the chat can go on without its older messages. Keep what the user \
asked and wants, the facts found in their shards with the shard paths they came from, \
decisions made, and anything left open. Write it in the language of the chat, as short \
as it can be while keeping all of that. Give only the summary.";

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
        thinking: false,
        cache_key: &turn.chat,
    };
    let reply = chat::stream(&turn.model.target, &request, &mut |_| {}, &turn.stop).await?;
    match reply.text.trim() {
        "" => Err(ChatError::Failed),
        text => Ok(text.to_string()),
    }
}

const TITLE_PROMPT: &str = "You name a chat between a user and the assistant of their \
notes app, for a list of chats. Give a name of at most six words that says what the chat is \
about, in the language of the chat, with no quotes and no full stop. Give only the name.";

/// The longest piece of the chat a title is made from.
const TITLE_PIECE: usize = 2_000;

/// A short name for a chat, from its first question and answer.
pub async fn short_title(
    model: &Model,
    chat: &str,
    question: &str,
    answer: &str,
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
        thinking: false,
        cache_key: chat,
    };
    let reply = chat::stream(&model.target, &request, &mut |_| {}, &StopToken::default()).await?;
    clean_title(&reply.text).ok_or(ChatError::Failed)
}

/// A model's name for a chat as a title: its first line, without the
/// quotes, label or full stop models add anyway.
fn clean_title(reply: &str) -> Option<String> {
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

#[cfg(test)]
mod tests;
