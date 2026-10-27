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
mod links;
mod read;
mod write;

use schemars::JsonSchema;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::{Map, Value};
use std::fmt;
use std::path::{Component, Path, PathBuf};
use std::sync::OnceLock;

/// The vault the tools work on, for one call. Nothing watches the vault
/// between calls, so nothing holds its folder open: the first time a call
/// reads the index, the shards changed since are indexed (`Vault::index`).
pub struct Vault {
    pub root: PathBuf,
    /// Where the vaults' histories are kept (`sync::sync_root`).
    pub sync_root: PathBuf,
    /// How bringing the index up to date went, once this call has.
    caught_up: OnceLock<Result<(), String>>,
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
    pub fn new(root: PathBuf, sync_root: PathBuf) -> Self {
        Self { root, sync_root, caught_up: OnceLock::new() }
    }

    /// The file or folder at `relative` in the vault. Refuses paths that
    /// leave the vault, by `..`, from the root, or through a link, the
    /// folders the vault tree hides (`vault::is_scanned_name`), by any name
    /// that leads there, and other vaults inside this one.
    pub fn resolve(&self, relative: &str) -> ToolResult<PathBuf> {
        let trimmed = relative.trim().trim_start_matches("./");
        let path = Path::new(trimmed);
        let not_in_vault = || {
            ToolError(format!(
                "'{}' isn't a path in the vault. Use one relative to the vault, like Folder/Shard.md.",
                relative
            ))
        };
        let shown = !path.is_absolute()
            && path.components().all(|part| match part {
                Component::Normal(name) => crate::vault::is_scanned_name(&name.to_string_lossy()),
                Component::CurDir => true,
                _ => false,
            });
        if !shown {
            return Err(not_in_vault());
        }
        let full = self.root.join(path);

        // The nearest part that exists, by its real name: a link, or another
        // name for the same folder (like a Windows short name), must still
        // lead inside the vault and somewhere the tree shows.
        let existing = full.ancestors().find(|part| part.exists()).unwrap_or(&self.root);
        let real = self.root.canonicalize().ok().zip(existing.canonicalize().ok());
        let Some((root, real)) = real.filter(|(root, real)| crate::vault_access::is_within(root, real)) else {
            return Err(ToolError(format!("'{}' leads outside the vault", relative)));
        };
        if !crate::vault::is_scanned_path(&root, &real) {
            return Err(not_in_vault());
        }
        if crate::sync::state::crosses_into_another_vault(&root, &real) {
            return Err(ToolError(format!("'{}' is in another vault inside this one", relative)));
        }
        Ok(full)
    }

    /// Whether `target`, a path as the index stores it, is a file in the
    /// vault. Anything outside it counts as not there.
    pub fn has_file(&self, target: &str) -> bool {
        let path = Path::new(target);
        path.is_absolute()
            && crate::vault_access::is_within(&self.root, path)
            && self.resolve(&self.relative(path)).is_ok_and(|path| path.is_file())
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

    /// The search index, with the vault's shards that changed since it was
    /// last indexed, by the app or an earlier call, indexed first.
    pub fn index(&self) -> ToolResult<rusqlite::Connection> {
        self.index_caught_up().map(|(conn, _)| conn)
    }

    /// [`Vault::index`], and whether it was brought up to date just now, so
    /// it holds what changed before this.
    pub(crate) fn index_caught_up(&self) -> ToolResult<(rusqlite::Connection, bool)> {
        let conn = crate::db::open_connection()?;
        let mut now = false;
        self.caught_up
            .get_or_init(|| {
                now = true;
                let indexed = crate::db::indexer::index_vault(&conn, &self.root)?;
                if indexed.indexed + indexed.errors > 0 {
                    eprintln!(
                        "[Netherstone] Indexed {}: {} changed, {} failed",
                        self.root.display(),
                        indexed.indexed,
                        indexed.errors
                    );
                }
                Ok(())
            })
            .clone()?;
        Ok((conn, now))
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
        Vault::new(root, dir.join("sync"))
    }

    #[test]
    fn paths_stay_in_the_vault() {
        let vault = vault("tools-resolve");
        assert_eq!(vault.resolve("Notes/Plan.md").unwrap(), vault.root.join("Notes/Plan.md"));
        assert_eq!(vault.resolve("./Plan.md").unwrap(), vault.root.join("Plan.md"));
        for outside in [
            "../secret.md",
            "Notes/../../x.md",
            "/etc/passwd",
            ".netherstone/vault-id",
            "Notes/.git/config",
            "_attachments/Trip.jpg",
            "Code/node_modules",
        ] {
            assert!(vault.resolve(outside).is_err(), "{outside}");
        }
    }

    /// Another name for a hidden folder, like a link here or a short name
    /// (GIT~1) on Windows, doesn't get past the rule.
    #[cfg(unix)]
    #[test]
    fn hidden_folders_stay_hidden_by_any_name() {
        let vault = vault("tools-resolve-hidden");
        std::fs::create_dir_all(vault.root.join(".git")).unwrap();
        std::fs::create_dir_all(vault.root.join("_attachments")).unwrap();
        std::os::unix::fs::symlink(vault.root.join(".git"), vault.root.join("GIT~1")).unwrap();
        std::os::unix::fs::symlink(vault.root.join("_attachments"), vault.root.join("Pictures")).unwrap();
        for hidden in ["GIT~1", "GIT~1/config", "Pictures/Trip.jpg"] {
            assert!(vault.resolve(hidden).is_err(), "{hidden}");
        }
    }

    #[test]
    fn other_vaults_inside_stay_out() {
        let vault = vault("tools-resolve-nested");
        let inner = vault.root.join("Inner");
        std::fs::create_dir_all(inner.join("Notes")).unwrap();
        std::fs::write(inner.join("Notes/Plan.md"), "Inner plan").unwrap();
        crate::sync::state::load_or_create_record(&vault.sync_root, &inner).unwrap();

        for nested in ["Inner", "Inner/Notes/Plan.md", "Inner/Notes/New.md"] {
            assert!(vault.resolve(nested).is_err(), "{nested}");
        }
        assert!(!vault.has_file(&inner.join("Notes/Plan.md").to_string_lossy()));
        assert!(vault.resolve("Other/Plan.md").is_ok());
    }

    #[test]
    fn only_files_in_the_vault_are_there() {
        let vault = vault("tools-has-file");
        let shard = vault.root.join("Plan.md");
        std::fs::write(&shard, "The plan").unwrap();
        let outside = vault.root.parent().unwrap().join("Outside.md");
        std::fs::write(&outside, "Not in the vault").unwrap();

        assert!(vault.has_file(&shard.to_string_lossy()));
        assert!(!vault.has_file(&outside.to_string_lossy()));
        assert!(!vault.has_file("Plan.md"));
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
