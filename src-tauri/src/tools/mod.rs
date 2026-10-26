//! The vault tools AI apps use: finding, reading and changing shards,
//! drawings and links. They take a [`Vault`] and JSON arguments and return
//! JSON, and know nothing of how they're called, so the MCP server
//! (`crate::mcp`) and the app's own assistant share them as they are.
//!
//! Paths in and out are vault-relative with `/` separators. Nothing is ever
//! deleted, and every change saves versions in History first (`edits.rs`).

mod drawings;
mod edits;
mod find;
pub mod guide;
mod history;
pub mod index;
mod links;
mod read;
mod write;

use schemars::JsonSchema;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use std::fmt;
use std::path::{Component, Path, PathBuf};

/// The vault the tools work on.
pub struct Vault {
    pub root: PathBuf,
    /// Where the vaults' histories are kept (`sync::sync_root`).
    pub sync_root: PathBuf,
}

/// Who asked for a change: the AI app, as it names itself. History notes
/// each change it makes with this name.
pub struct Caller {
    pub app: String,
}

#[derive(Debug, PartialEq)]
pub struct ToolError(pub String);

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl From<String> for ToolError {
    fn from(message: String) -> Self {
        ToolError(message)
    }
}

impl From<rusqlite::Error> for ToolError {
    fn from(error: rusqlite::Error) -> Self {
        ToolError(format!("The vault's index failed: {}", error))
    }
}

pub type ToolResult<T> = Result<T, ToolError>;

impl Vault {
    /// The file or folder at `relative` in the vault. Refuses paths that
    /// leave the vault, by `..`, from the root, or through a link, and the
    /// hidden folders Netherstone and other apps keep there.
    pub fn resolve(&self, relative: &str) -> ToolResult<PathBuf> {
        let trimmed = relative.trim().trim_start_matches("./");
        let path = Path::new(trimmed);
        let escapes = path.is_absolute()
            || path.components().any(|part| match part {
                Component::Normal(name) => name.to_string_lossy().starts_with('.'),
                Component::CurDir => false,
                _ => true,
            });
        if escapes {
            return Err(ToolError(format!(
                "'{}' isn't a path in the vault. Use one relative to the vault, like Folder/Shard.md.",
                relative
            )));
        }
        let full = self.root.join(path);

        // Through links, too: the nearest part that exists must be inside.
        let existing = full.ancestors().find(|part| part.exists()).unwrap_or(&self.root);
        let inside = self
            .root
            .canonicalize()
            .ok()
            .zip(existing.canonicalize().ok())
            .is_some_and(|(root, real)| crate::vault_access::is_within(&root, &real));
        if !inside {
            return Err(ToolError(format!("'{}' leads outside the vault", relative)));
        }
        Ok(full)
    }

    /// `relative`, which must be a shard (`.md`) that exists.
    pub fn shard(&self, relative: &str) -> ToolResult<PathBuf> {
        let path = self.resolve(relative)?;
        if !crate::vault::is_markdown_path(&path) {
            return Err(ToolError(format!("'{}' isn't a shard (a .md file)", relative)));
        }
        if !path.is_file() {
            return Err(ToolError(format!("There's no shard at '{}'", relative)));
        }
        Ok(path)
    }

    /// `path` as the tools name it: relative to the vault, with `/`.
    pub fn relative(&self, path: &Path) -> String {
        crate::sync::vault_relative(&self.root, path)
            .unwrap_or_else(|_| path.to_string_lossy().replace('\\', "/"))
    }

    pub fn index(&self) -> ToolResult<rusqlite::Connection> {
        Ok(crate::db::open_connection()?)
    }
}

// ── Paging ───────────────────────────────────────────────────────────────────

/// Items a list returns when the caller doesn't say, and the most it may ask
/// for: enough to be useful, few enough to keep a reply small.
const PAGE_SIZE: usize = 50;
const MAX_PAGE_SIZE: usize = 200;

/// Where a page starts and how long it is, from the `cursor` the last page
/// gave and the `limit` asked for.
pub(crate) struct Page {
    pub offset: usize,
    pub limit: usize,
}

impl Page {
    pub fn new(cursor: Option<&str>, limit: Option<usize>) -> ToolResult<Self> {
        let offset = match cursor {
            Some(cursor) => cursor
                .parse()
                .map_err(|_| ToolError("That cursor isn't one a list gave out".to_string()))?,
            None => 0,
        };
        Ok(Self {
            offset,
            limit: limit.unwrap_or(PAGE_SIZE).clamp(1, MAX_PAGE_SIZE),
        })
    }

    /// One past the page, so a query can tell whether there's more.
    pub fn fetch(&self) -> usize {
        self.limit + 1
    }

    /// Trims `items` (fetched with [`Page::fetch`]) to the page, and gives
    /// the cursor of the next page when there is one.
    pub fn finish<T>(&self, mut items: Vec<T>) -> (Vec<T>, Option<String>) {
        let more = items.len() > self.limit;
        items.truncate(self.limit);
        (items, more.then(|| (self.offset + self.limit).to_string()))
    }

    /// The page of `items`, a whole list in memory.
    pub fn of<T>(&self, items: Vec<T>) -> (Vec<T>, Option<String>) {
        let rest: Vec<T> = items.into_iter().skip(self.offset).take(self.fetch()).collect();
        self.finish(rest)
    }
}

// ── The tools ────────────────────────────────────────────────────────────────

type Run = Box<dyn Fn(&Vault, &Caller, Value) -> ToolResult<Value> + Send + Sync>;

pub struct Tool {
    pub name: &'static str,
    pub title: &'static str,
    pub description: String,
    /// JSON Schema of the arguments.
    pub input_schema: Map<String, Value>,
    /// True when it only reads.
    pub read_only: bool,
    run: Run,
}

impl Tool {
    pub fn call(&self, vault: &Vault, caller: &Caller, arguments: Value) -> ToolResult<Value> {
        (self.run)(vault, caller, arguments)
    }
}

fn tool<P, R>(
    name: &'static str,
    title: &'static str,
    description: String,
    read_only: bool,
    run: fn(&Vault, &Caller, P) -> ToolResult<R>,
) -> Tool
where
    P: DeserializeOwned + JsonSchema + 'static,
    R: Serialize + 'static,
{
    let input_schema = match serde_json::to_value(schemars::schema_for!(P)) {
        Ok(Value::Object(schema)) => schema,
        _ => Map::new(),
    };
    Tool {
        name,
        title,
        description,
        input_schema,
        read_only,
        run: Box::new(move |vault, caller, arguments| {
            // An empty call is a call with no arguments.
            let arguments = if arguments.is_null() { Value::Object(Map::new()) } else { arguments };
            let params: P = serde_json::from_value(arguments)
                .map_err(|e| ToolError(format!("Those arguments don't fit {}: {}", name, e)))?;
            let result = run(vault, caller, params)?;
            serde_json::to_value(result).map_err(|e| ToolError(e.to_string()))
        }),
    }
}

/// Every tool, in the order AI apps list them.
pub fn all() -> Vec<Tool> {
    vec![
        tool("search", "Search", find::SEARCH.to_string(), true, find::search),
        tool("list_folder", "List a folder", find::LIST_FOLDER.to_string(), true, find::list_folder),
        tool("read", "Read shards", read::READ.to_string(), true, read::read),
        tool("create_shard", "Create a shard", guide::with_format(write::CREATE_SHARD), false, write::create_shard),
        tool("edit_shard", "Edit a shard", guide::with_format(write::EDIT_SHARD), false, write::edit_shard),
        tool("move", "Move or rename", write::MOVE.to_string(), false, write::move_path),
        tool("create_folder", "Create a folder", write::CREATE_FOLDER.to_string(), false, write::create_folder),
        tool("links", "Links", links::LINKS.to_string(), true, links::links),
        tool("fix_link", "Fix a link", links::FIX_LINK.to_string(), false, links::fix_link),
        tool("list_tags", "List tags", find::LIST_TAGS.to_string(), true, find::list_tags),
        tool("read_drawing", "Read a drawing", drawings::READ_DRAWING.to_string(), true, drawings::read_drawing),
        tool("edit_drawing", "Edit a drawing", drawings::EDIT_DRAWING.to_string(), false, drawings::edit_drawing),
        tool("tables", "Tables and charts", read::TABLES.to_string(), false, read::tables),
        tool("history", "History", history::HISTORY.to_string(), false, history::history),
        tool("vault_overview", "Vault overview", find::VAULT_OVERVIEW.to_string(), true, find::vault_overview),
    ]
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A vault in a fresh folder, with its history beside it.
    pub fn vault(name: &str) -> Vault {
        let dir = crate::sync::state::tests::temp_dir(name);
        let root = dir.join("vault");
        std::fs::create_dir_all(&root).unwrap();
        Vault {
            root,
            sync_root: dir.join("sync"),
        }
    }

    #[test]
    fn paths_stay_in_the_vault() {
        let vault = vault("tools-resolve");
        assert_eq!(vault.resolve("Notes/Plan.md").unwrap(), vault.root.join("Notes/Plan.md"));
        assert_eq!(vault.resolve("./Plan.md").unwrap(), vault.root.join("Plan.md"));
        for outside in ["../secret.md", "Notes/../../x.md", "/etc/passwd", ".netherstone/vault-id", "Notes/.git/config"] {
            assert!(vault.resolve(outside).is_err(), "{outside}");
        }
    }

    #[test]
    fn pages_follow_their_cursor() {
        let first = Page::new(None, Some(2)).unwrap();
        let (items, next) = first.of(vec![1, 2, 3, 4, 5]);
        assert_eq!((items, next.as_deref()), (vec![1, 2], Some("2")));
        let last = Page::new(Some("4"), Some(2)).unwrap();
        assert_eq!(last.of(vec![1, 2, 3, 4, 5]), (vec![5], None));
        assert!(Page::new(Some("nope"), None).is_err());
    }

    #[test]
    fn every_tool_has_an_object_schema() {
        let tools = all();
        assert_eq!(tools.len(), 15);
        for tool in &tools {
            assert_eq!(tool.input_schema.get("type"), Some(&Value::from("object")), "{}", tool.name);
        }
    }
}
