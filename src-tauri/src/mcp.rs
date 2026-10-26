//! The MCP server AI apps start as `Netherstone mcp`, talking over stdin
//! and stdout. It runs without a window and works on the vaults picked in
//! Settings, the one the app opened last unless a call names another. It
//! offers the vault tools (`crate::tools`), the shard format guide and a few
//! ready-made prompts. It does nothing while "Connect your AI apps" is off.

use crate::db::settings::{self, KnownVault};
use crate::tools::{self, Caller, Page, Tool, Vault, guide};
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, GetPromptRequestParams,
    GetPromptResponse, GetPromptResult, Implementation, ListPromptsResult, ListResourcesResult,
    ListToolsResult, PaginatedRequestParams, Prompt, PromptArgument, PromptMessage,
    ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult, Resource,
    ResourceContents, Role, ServerCapabilities, ServerConfig, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler, ServiceExt};
use serde_json::{Map, Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// A vault AI apps have worked on, kept indexed while the server runs.
struct Session {
    vault: Arc<Vault>,
    _watch: tools::index::Watch,
}

/// A vault's session, opened by the first call that needs it.
type Slot = Arc<Mutex<Option<Session>>>;

#[derive(Clone)]
struct Server {
    tools: Arc<Vec<Tool>>,
    /// One slot per vault, so opening a big one doesn't hold up calls to
    /// the others.
    sessions: Arc<Mutex<HashMap<PathBuf, Slot>>>,
}

/// What a call can't go ahead without, said so the AI app can tell the user.
const TURNED_OFF: &str = "Netherstone isn't letting AI apps use its vaults. Turn on Connect your AI apps in Netherstone's Settings, then try again.";
const NO_VAULT: &str = "No vault has been opened in Netherstone yet. Open one in the app, then try again.";
const NONE_PICKED: &str = "Netherstone isn't letting AI apps use any of its vaults yet. Pick the ones they may use in Netherstone's Settings, then try again.";

/// The argument every vault tool takes to name its vault.
const VAULT_ARGUMENT: &str = "vault";
const VAULT_ARGUMENT_DESCRIPTION: &str = "The vault to work on: a path list_vaults gave. \
Leave it out to work on the vault opened last in Netherstone.";

const LIST_VAULTS: &str = "list_vaults";
const LIST_VAULTS_DESCRIPTION: &str = "List the vaults you may use, the one opened last \
in Netherstone first. Give a vault's path as the vault argument of the other tools to \
work on it; without one they work on the vault opened last. Results come a page at a \
time: pass next_cursor back as cursor for the next page.";

const INSTRUCTIONS: &str = "Netherstone is a local-first knowledge app. These tools \
work on the user's vaults: shards (Markdown notes), folders, links between shards, \
tags, tables and Excalidraw drawings. They use the vault opened last in Netherstone \
unless you pass another from list_vaults as vault. Paths are relative to the vault. Read a shard before changing it, and change only what was asked: \
edit_shard changes part of a shard and leaves the rest as it is. Nothing is ever \
deleted, and every change is saved in the shard's History first, so the user can undo \
it. Give each change a short summary. Before writing shards, read the format guide \
resource (netherstone://guide/shard-format).";

impl Server {
    fn new() -> Self {
        Self {
            tools: Arc::new(tools::all()),
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Opens the database, once AI apps may use it.
    fn settings(&self) -> Result<rusqlite::Connection, String> {
        let conn = crate::db::open_connection()?;
        if !settings::mcp_enabled(&conn).map_err(|e| e.to_string())? {
            return Err(TURNED_OFF.to_string());
        }
        Ok(conn)
    }

    /// The vault a call works on: `asked`, or the one opened last, if AI
    /// apps may use it. It's indexed and watched from the first call to it.
    fn vault(&self, asked: Option<&str>) -> Result<Arc<Vault>, String> {
        let conn = self.settings()?;
        let picked = |vault: Option<KnownVault>| vault.filter(|vault| vault.ai_allowed);
        let known = match asked {
            Some(asked) => {
                let path = Path::new(asked);
                picked(settings::known_vault(&conn, path).map_err(|e| e.to_string())?).ok_or_else(|| {
                    // It may have been taken off the list since it was opened.
                    self.close(path);
                    format!("'{}' isn't a vault Netherstone lets AI apps use. list_vaults gives the ones it does.", asked)
                })?
            }
            None => {
                let last = settings::last_vault(&conn).map_err(|e| e.to_string())?.ok_or(NO_VAULT)?;
                if !last.ai_allowed {
                    let any = settings::known_vaults(&conn, true, 0, Some(1)).map_err(|e| e.to_string())?;
                    self.close(&last.path);
                    return Err(if any.is_empty() {
                        NONE_PICKED.to_string()
                    } else {
                        format!(
                            "Netherstone isn't letting AI apps use {}, the vault opened last. Pass one from list_vaults as vault.",
                            last.name()
                        )
                    });
                }
                last
            }
        };
        if !known.path.is_dir() {
            return Err(format!("The vault {} isn't at {} anymore", known.name(), known.path.display()));
        }

        let slot = {
            let mut sessions = self.sessions.lock().unwrap_or_else(|e| e.into_inner());
            sessions.entry(known.path.clone()).or_default().clone()
        };
        let mut session = slot.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(open) = session.as_ref() {
            return Ok(open.vault.clone());
        }
        let vault = Arc::new(Vault {
            root: known.path,
            sync_root: crate::sync::sync_root()?,
        });
        let watch = tools::index::keep_indexed(&vault)?;
        *session = Some(Session {
            vault: vault.clone(),
            _watch: watch,
        });
        Ok(vault)
    }

    /// Stops watching a vault AI apps may no longer use.
    fn close(&self, path: &Path) {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner()).remove(path);
    }

    /// The vaults AI apps may use, a page at a time.
    fn list_vaults(&self, arguments: &Map<String, Value>) -> Result<Value, String> {
        let conn = self.settings()?;
        let cursor = arguments.get("cursor").and_then(Value::as_str);
        let limit = arguments.get("limit").and_then(Value::as_u64).map(|limit| limit as usize);
        let page = Page::new(cursor, limit).map_err(|error| error.0)?;
        let last = settings::last_vault(&conn).map_err(|e| e.to_string())?.map(|vault| vault.path);
        let vaults = settings::known_vaults(&conn, true, page.offset, Some(page.fetch())).map_err(|e| e.to_string())?;
        let (vaults, next_cursor) = page.finish(vaults);
        let vaults: Vec<Value> = vaults
            .into_iter()
            .map(|vault| {
                json!({
                    "name": vault.name(),
                    "path": vault.path.to_string_lossy(),
                    "opened_last": last.as_ref() == Some(&vault.path),
                })
            })
            .collect();
        Ok(json!({ "vaults": vaults, "next_cursor": next_cursor }))
    }
}

/// The AI app's name, as it gives it when it connects.
fn caller(context: &RequestContext<RoleServer>) -> Caller {
    let app = context
        .client_info()
        .map(|info| info.title.filter(|title| !title.trim().is_empty()).unwrap_or(info.name))
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "an AI app".to_string());
    Caller { app }
}

fn annotated(tool: rmcp::model::Tool, title: &str, read_only: bool) -> rmcp::model::Tool {
    tool.with_title(title.to_string()).with_annotations(
        ToolAnnotations::with_title(title)
            .read_only(read_only)
            .destructive(false)
            .open_world(false),
    )
}

/// A vault tool, with the argument that names its vault added.
fn mcp_tool(tool: &Tool) -> rmcp::model::Tool {
    let mut schema = tool.input_schema.clone();
    if let Value::Object(properties) = schema.entry("properties").or_insert_with(|| json!({})) {
        properties.insert(
            VAULT_ARGUMENT.to_string(),
            json!({ "type": "string", "description": VAULT_ARGUMENT_DESCRIPTION }),
        );
    }
    annotated(
        rmcp::model::Tool::new(tool.name, tool.description.clone(), Arc::new(schema)),
        tool.title,
        tool.read_only,
    )
}

fn list_vaults_tool() -> rmcp::model::Tool {
    let schema = json!({
        "type": "object",
        "properties": {
            "cursor": { "type": "string", "description": "The next_cursor of the last page, for the page after it." },
            "limit": { "type": "integer", "minimum": 1, "description": "Results per page." },
        },
    })
    .as_object()
    .cloned()
    .unwrap_or_default();
    annotated(
        rmcp::model::Tool::new(LIST_VAULTS, LIST_VAULTS_DESCRIPTION, Arc::new(schema)),
        "List vaults",
        true,
    )
}

// ── Prompts ──────────────────────────────────────────────────────────────────

struct PromptSpec {
    name: &'static str,
    title: &'static str,
    description: &'static str,
    /// The argument it takes, a shard's path, if any.
    shard: bool,
    /// What it asks for; `{path}` is the shard.
    text: &'static str,
}

const PROMPTS: &[PromptSpec] = &[
    PromptSpec {
        name: "summarize_shard",
        title: "Summarize a shard",
        description: "Summarize one shard of your Netherstone vault.",
        shard: true,
        text: "Read the shard {path} in my Netherstone vault and summarize it: what it's \
about, its main points, and anything left open. Keep it short.",
    },
    PromptSpec {
        name: "find_related",
        title: "Find related shards",
        description: "Find the shards in your vault related to one shard.",
        shard: true,
        text: "Read the shard {path} in my Netherstone vault. Then find the shards related \
to it: search for its main subjects and tags, and look at its links and backlinks. List \
the related shards with a line on how each relates, and say which ones it doesn't link \
to yet. Don't change anything.",
    },
    PromptSpec {
        name: "review_week",
        title: "Review this week's writing",
        description: "Look back at what you wrote in your vault this week.",
        shard: false,
        text: "Review what I wrote in my Netherstone vault this week: search for the shards \
changed in the last 7 days and read them. Tell me the main themes, what's unfinished or \
left open, and which shards could link to each other. Don't change anything.",
    },
    PromptSpec {
        name: "shard_to_diagram",
        title: "Turn a shard into a diagram",
        description: "Draw a shard's ideas as an Excalidraw diagram and show it in the shard.",
        shard: true,
        text: "Read the shard {path} in my Netherstone vault and draw its main ideas as a \
diagram: create a drawing next to it with edit_drawing, with a labeled shape for each \
idea and arrows for how they connect, laid out so it reads clearly. Then embed the \
drawing in the shard, under the heading it fits best or at the end.",
    },
];

const PATH_ARGUMENT: &str = "path";

impl ServerHandler for Server {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(
            ServerCapabilities::builder()
                .enable_prompts()
                .enable_resources()
                .enable_tools()
                .build(),
        )
        .with_server_info(
            Implementation::new("netherstone", env!("CARGO_PKG_VERSION")).with_title("Netherstone"),
        )
        .with_instructions(INSTRUCTIONS)
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        let vault_tools = self.tools.iter().map(mcp_tool);
        Ok(ListToolsResult::with_all_items(std::iter::once(list_vaults_tool()).chain(vault_tools).collect()))
    }

    fn get_tool(&self, name: &str) -> Option<rmcp::model::Tool> {
        if name == LIST_VAULTS {
            return Some(list_vaults_tool());
        }
        self.tools.iter().find(|tool| tool.name == name).map(mcp_tool)
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let caller = caller(&context);
        let server = self.clone();
        let name = request.name.to_string();
        let mut arguments = request.arguments.unwrap_or_default();
        // The tools read and write files and the index, so they run off the
        // threads that read and write messages.
        let result = tokio::task::spawn_blocking(move || {
            if name == LIST_VAULTS {
                return server.list_vaults(&arguments);
            }
            let asked = match arguments.remove(VAULT_ARGUMENT) {
                None | Some(Value::Null) => None,
                Some(Value::String(asked)) => Some(asked),
                Some(_) => return Err("vault takes a path list_vaults gave".to_string()),
            };
            let vault = server.vault(asked.as_deref())?;
            let tool = server
                .tools
                .iter()
                .find(|tool| tool.name == name)
                .ok_or_else(|| format!("There's no tool named {}", name))?;
            tool.call(&vault, &caller, Value::Object(arguments)).map_err(|error| error.0)
        })
        .await
        .map_err(|e| ErrorData::internal_error(e.to_string(), None))?;

        Ok(match result {
            Ok(value) => CallToolResult::structured(value),
            Err(message) => CallToolResult::error(vec![ContentBlock::text(message)]),
        }
        .into())
    }

    async fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListResourcesResult, ErrorData> {
        Ok(ListResourcesResult::with_all_items(vec![
            Resource::new(guide::URI, "shard-format")
                .with_title("How to write shards")
                .with_description("How Netherstone shards are written: Markdown, links, tags, tables, charts, toggles and drawings.")
                .with_mime_type("text/markdown"),
        ]))
    }

    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<ReadResourceResponse, ErrorData> {
        if request.uri != guide::URI {
            return Err(ErrorData::resource_not_found(format!("There's no resource {}", request.uri), None));
        }
        let contents = match ResourceContents::text(guide::GUIDE, guide::URI) {
            ResourceContents::TextResourceContents { uri, text, meta, .. } => {
                ResourceContents::TextResourceContents { uri, text, meta, mime_type: Some("text/markdown".into()) }
            }
            other => other,
        };
        Ok(ReadResourceResult::new(vec![contents]).into())
    }

    async fn list_prompts(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListPromptsResult, ErrorData> {
        Ok(ListPromptsResult::with_all_items(
            PROMPTS
                .iter()
                .map(|prompt| {
                    let arguments = prompt.shard.then(|| {
                        vec![PromptArgument::new(PATH_ARGUMENT)
                            .with_title("Shard")
                            .with_description("The shard's path in the vault, like Projects/Plan.md")
                            .with_required(true)]
                    });
                    Prompt::new(prompt.name, Some(prompt.description), arguments).with_title(prompt.title)
                })
                .collect(),
        ))
    }

    async fn get_prompt(
        &self,
        request: GetPromptRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<GetPromptResponse, ErrorData> {
        let prompt = PROMPTS
            .iter()
            .find(|prompt| prompt.name == request.name)
            .ok_or_else(|| ErrorData::invalid_params(format!("There's no prompt {}", request.name), None))?;
        let path = request
            .arguments
            .as_ref()
            .and_then(|arguments| arguments.get(PATH_ARGUMENT))
            .and_then(|path| path.as_str())
            .map(str::to_string);
        let text = match (prompt.shard, path) {
            (true, Some(path)) => prompt.text.replace("{path}", &path),
            (true, None) => {
                return Err(ErrorData::invalid_params("This prompt needs the shard's path", None));
            }
            (false, _) => prompt.text.to_string(),
        };
        Ok(GetPromptResult::new(vec![PromptMessage::new_text(Role::User, text)])
            .with_description(prompt.description)
            .into())
    }
}

/// Runs the server until the AI app that started it closes the connection.
pub fn run() -> Result<(), String> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .map_err(|e| e.to_string())?;
    runtime.block_on(async {
        let service = Server::new()
            .serve(rmcp::transport::io::stdio_pipes())
            .await
            .map_err(|e| e.to_string())?;
        service.waiting().await.map_err(|e| e.to_string())?;
        Ok(())
    })
}
