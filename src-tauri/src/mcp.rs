//! The MCP server AI apps start as `Netherstone mcp`, talking over stdin
//! and stdout. It runs without a window, works on the vault the app opened
//! last, and offers the vault tools (`crate::tools`), the shard format
//! guide and a few ready-made prompts. It does nothing while "Connect your
//! AI apps" is off in Settings.

use crate::tools::{self, Caller, Tool, Vault, guide};
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, GetPromptRequestParams,
    GetPromptResponse, GetPromptResult, Implementation, ListPromptsResult, ListResourcesResult,
    ListToolsResult, PaginatedRequestParams, Prompt, PromptArgument, PromptMessage,
    ReadResourceRequestParams, ReadResourceResponse, ReadResourceResult, Resource,
    ResourceContents, Role, ServerCapabilities, ServerConfig, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::{ErrorData, RoleServer, ServerHandler, ServiceExt};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// The vault being worked on, kept indexed while it is.
struct Session {
    vault: Arc<Vault>,
    _watch: tools::index::Watch,
}

#[derive(Clone)]
struct Server {
    tools: Arc<Vec<Tool>>,
    session: Arc<Mutex<Option<Session>>>,
}

/// What a call can't go ahead without, said so the AI app can tell the user.
const TURNED_OFF: &str = "Netherstone isn't letting AI apps use the vault. Turn on Connect your AI apps in Netherstone's Settings, then try again.";
const NO_VAULT: &str = "No vault has been opened in Netherstone yet. Open one in the app, then try again.";

const INSTRUCTIONS: &str = "Netherstone is a local-first knowledge app. These tools \
work on the user's vault, the one they opened last in Netherstone: shards (Markdown \
notes), folders, links between shards, tags, tables and Excalidraw drawings. Paths are \
relative to the vault. Read a shard before changing it, and change only what was asked: \
edit_shard changes part of a shard and leaves the rest as it is. Nothing is ever \
deleted, and every change is saved in the shard's History first, so the user can undo \
it. Give each change a short summary. Before writing shards, read the format guide \
resource (netherstone://guide/shard-format).";

impl Server {
    fn new() -> Self {
        Self {
            tools: Arc::new(tools::all()),
            session: Arc::new(Mutex::new(None)),
        }
    }

    /// The vault to work on, once AI apps may: the one opened last, indexed
    /// and watched from the first call that needs it.
    fn vault(&self) -> Result<Arc<Vault>, String> {
        let conn = crate::db::open_connection()?;
        if !crate::db::settings::mcp_enabled(&conn).map_err(|e| e.to_string())? {
            return Err(TURNED_OFF.to_string());
        }
        let root: PathBuf = crate::db::settings::last_vault(&conn)
            .map_err(|e| e.to_string())?
            .filter(|root| root.is_dir())
            .ok_or_else(|| NO_VAULT.to_string())?;

        let mut session = self.session.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(open) = session.as_ref().filter(|open| open.vault.root == root) {
            return Ok(open.vault.clone());
        }
        // A different vault was opened in the app since: work on that one.
        let vault = Arc::new(Vault {
            root,
            sync_root: crate::sync::sync_root()?,
        });
        let watch = tools::index::keep_indexed(&vault)?;
        *session = Some(Session {
            vault: vault.clone(),
            _watch: watch,
        });
        Ok(vault)
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

fn mcp_tool(tool: &Tool) -> rmcp::model::Tool {
    rmcp::model::Tool::new(tool.name, tool.description.clone(), Arc::new(tool.input_schema.clone()))
        .with_title(tool.title)
        .with_annotations(
            ToolAnnotations::with_title(tool.title)
                .read_only(tool.read_only)
                .destructive(false)
                .open_world(false),
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
        Ok(ListToolsResult::with_all_items(self.tools.iter().map(mcp_tool).collect()))
    }

    fn get_tool(&self, name: &str) -> Option<rmcp::model::Tool> {
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
        let arguments = request.arguments.map(serde_json::Value::Object).unwrap_or_default();
        // The tools read and write files and the index, so they run off the
        // threads that read and write messages.
        let result = tokio::task::spawn_blocking(move || {
            let vault = server.vault()?;
            let tool = server
                .tools
                .iter()
                .find(|tool| tool.name == name)
                .ok_or_else(|| format!("There's no tool named {}", name))?;
            tool.call(&vault, &caller, arguments).map_err(|error| error.0)
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
