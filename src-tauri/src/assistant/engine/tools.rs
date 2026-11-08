//! The tools an answer can call: read tools run, write tools only propose
//! their change, and the app's own remember tool offers a memory item.

use super::run::Out;
use super::{Event, Turn};
use crate::assistant::chat::{Added, Call, CallResult, File, ToolSpec};
use crate::assistant::files;
use crate::assistant::memory;
use crate::assistant::sessions::ChangeState;
use crate::tools::proposals::{self, Op, WRITE_TOOLS};
use crate::tools::{self, Caller, Tool};
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::Ordering;

/// A tool's output longer than this is cut, so one read can't fill the chat.
const MAX_TOOL_OUTPUT: usize = 60_000;

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

pub(super) fn specs(tools: &[Tool]) -> Vec<ToolSpec> {
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

pub(super) async fn run_calls(
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
pub(super) async fn propose(turn: &Turn, call: &Call) -> Result<String, String> {
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
pub(super) async fn offer(turn: &Turn, call: &Call) -> Result<String, String> {
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
