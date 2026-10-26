//! Finding things in a vault: search, folders, tags, and the overview.

use super::{Caller, Page, ToolError, ToolResult, Vault};
use crate::markdown_text::TextPart;
use rusqlite::params;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Shown highlighted in a snippet: the words searched for, or the tag.
fn snippet_text(parts: &[TextPart]) -> String {
    parts
        .iter()
        .map(|part| {
            if part.highlight {
                format!("**{}**", part.text)
            } else {
                part.text.clone()
            }
        })
        .collect()
}

/// Unix seconds at the start of `day` (YYYY-MM-DD) on this device.
fn day_start(day: &str) -> ToolResult<i64> {
    let date = chrono::NaiveDate::parse_from_str(day.trim(), "%Y-%m-%d")
        .map_err(|_| ToolError(format!("'{}' isn't a date like 2026-10-26", day)))?;
    date.and_hms_opt(0, 0, 0)
        .and_then(|time| time.and_local_timezone(chrono::Local).earliest())
        .map(|time| time.timestamp())
        .ok_or_else(|| ToolError(format!("'{}' isn't a date like 2026-10-26", day)))
}

pub(super) fn local_date(unix_seconds: i64) -> String {
    chrono::DateTime::from_timestamp(unix_seconds, 0)
        .map(|time| time.with_timezone(&chrono::Local).format("%Y-%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

// ── search ───────────────────────────────────────────────────────────────────

pub const SEARCH: &str = "Find shards in the vault. With a query, finds the shards \
whose text has all its words (as word starts), best matches first, each with a \
snippet where the words are **bold**. Without one, lists the shards the filters \
match, newest first: use it for recently changed shards (modified_after) or \
shards with a tag. Results come a page at a time: pass next_cursor back as \
cursor for more.";

#[derive(Deserialize, JsonSchema)]
pub struct SearchParams {
    /// Words to find. Leave out to list by the filters alone.
    #[serde(default)]
    query: Option<String>,
    /// Only shards in this folder (vault-relative), at any depth.
    #[serde(default)]
    folder: Option<String>,
    /// Only shards with this tag, with or without the #.
    #[serde(default)]
    tag: Option<String>,
    /// Only shards changed on or after this day, as YYYY-MM-DD.
    #[serde(default)]
    modified_after: Option<String>,
    /// Only shards changed before this day, as YYYY-MM-DD.
    #[serde(default)]
    modified_before: Option<String>,
    #[serde(default)]
    cursor: Option<String>,
    /// Results per page.
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
pub struct Found {
    path: String,
    snippet: String,
    modified: String,
    words: i64,
}

#[derive(Serialize)]
pub struct FoundPage {
    results: Vec<Found>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

pub fn search(vault: &Vault, _: &Caller, params: SearchParams) -> ToolResult<FoundPage> {
    let page = Page::new(params.cursor.as_deref(), params.limit)?;
    let folder = params
        .folder
        .as_deref()
        .filter(|folder| !folder.trim().is_empty())
        .map(|folder| vault.resolve(folder))
        .transpose()?;
    let filter = crate::db::queries::FileFilter {
        query: params.query.as_deref().unwrap_or(""),
        folder: folder.as_deref(),
        tag: params.tag.as_deref().filter(|tag| !tag.trim().is_empty()),
        modified_after: params.modified_after.as_deref().map(day_start).transpose()?,
        modified_before: params.modified_before.as_deref().map(day_start).transpose()?,
    };
    let conn = vault.index()?;
    let found =
        crate::db::queries::find_files(&conn, &vault.root, &filter, page.offset, page.fetch())?;
    let (found, next_cursor) = page.finish(found);
    Ok(FoundPage {
        results: found
            .into_iter()
            .map(|file| Found {
                path: vault.relative(std::path::Path::new(&file.path)),
                snippet: snippet_text(&file.snippet),
                modified: local_date(file.last_modified),
                words: file.word_count,
            })
            .collect(),
        next_cursor,
    })
}

// ── list_folder ──────────────────────────────────────────────────────────────

pub const LIST_FOLDER: &str = "List what's in a folder of the vault: its folders, \
shards (.md) and drawings (.excalidraw), folders first, with when each was \
changed and how many words each shard has. Leave folder out for the top of the \
vault. One level at a time; list a subfolder to go deeper.";

#[derive(Deserialize, JsonSchema)]
pub struct ListFolderParams {
    /// The folder, vault-relative. Leave out for the top of the vault.
    #[serde(default)]
    folder: Option<String>,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
enum EntryKind {
    Folder,
    Shard,
    Drawing,
}

#[derive(Serialize)]
pub struct Entry {
    path: String,
    kind: EntryKind,
    modified: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    words: Option<i64>,
}

#[derive(Serialize)]
pub struct FolderPage {
    folder: String,
    entries: Vec<Entry>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

pub fn list_folder(vault: &Vault, _: &Caller, params: ListFolderParams) -> ToolResult<FolderPage> {
    let page = Page::new(params.cursor.as_deref(), params.limit)?;
    let folder = match params.folder.as_deref().filter(|f| !f.trim().is_empty()) {
        Some(folder) => vault.resolve(folder)?,
        None => vault.root.clone(),
    };
    let entries = std::fs::read_dir(&folder)
        .map_err(|_| ToolError(format!("There's no folder at '{}'", vault.relative(&folder))))?;

    let mut listed: Vec<(EntryKind, std::path::PathBuf, i64)> = entries
        .filter_map(Result::ok)
        .filter(|entry| crate::vault::is_scanned_name(&entry.file_name().to_string_lossy()))
        .filter_map(|entry| {
            let path = entry.path();
            let kind = if entry.file_type().ok()?.is_dir() {
                // Another vault inside this one is its own vault.
                if crate::sync::state::has_vault_marker(&path) {
                    return None;
                }
                EntryKind::Folder
            } else if crate::vault::is_markdown_path(&path) {
                EntryKind::Shard
            } else if crate::vault::is_drawing_path(&path) {
                EntryKind::Drawing
            } else {
                return None;
            };
            let modified = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |time| time.as_secs() as i64);
            Some((kind, path, modified))
        })
        .collect();
    listed.sort_by_cached_key(|(kind, path, _)| {
        (
            !matches!(kind, EntryKind::Folder),
            path.file_name().map(|n| n.to_string_lossy().to_lowercase()),
        )
    });
    let (listed, next_cursor) = page.of(listed);

    let conn = vault.index()?;
    let mut words = conn.prepare_cached("SELECT word_count FROM files WHERE path = ?1")?;
    let entries = listed
        .into_iter()
        .map(|(kind, path, modified)| {
            let words = matches!(kind, EntryKind::Shard)
                .then(|| words.query_row(params![path.to_string_lossy()], |row| row.get(0)).ok())
                .flatten();
            Entry {
                path: vault.relative(&path),
                kind,
                modified: local_date(modified),
                words,
            }
        })
        .collect();
    Ok(FolderPage {
        folder: vault.relative(&folder),
        entries,
        next_cursor,
    })
}

// ── list_tags ────────────────────────────────────────────────────────────────

pub const LIST_TAGS: &str = "List the vault's tags, most used first, with how many \
shards have each. Find the shards with a tag with search and its tag filter.";

#[derive(Deserialize, JsonSchema)]
pub struct ListTagsParams {
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
pub struct TagCount {
    tag: String,
    shards: i64,
}

#[derive(Serialize)]
pub struct TagPage {
    tags: Vec<TagCount>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

pub fn list_tags(vault: &Vault, _: &Caller, params: ListTagsParams) -> ToolResult<TagPage> {
    let page = Page::new(params.cursor.as_deref(), params.limit)?;
    let conn = vault.index()?;
    let mut stmt = conn.prepare(
        "SELECT t.tag, COUNT(DISTINCT t.file_id) AS shards FROM tags t
         JOIN files f ON f.id = t.file_id
         WHERE f.vault_path = ?1
         GROUP BY t.tag
         ORDER BY shards DESC, t.tag
         LIMIT ?2 OFFSET ?3",
    )?;
    let tags = stmt
        .query_map(
            params![
                crate::db::attachments::vault_key(&vault.root),
                page.fetch() as i64,
                page.offset as i64
            ],
            |row| {
                Ok(TagCount {
                    tag: row.get(0)?,
                    shards: row.get(1)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let (tags, next_cursor) = page.finish(tags);
    Ok(TagPage { tags, next_cursor })
}

// ── vault_overview ───────────────────────────────────────────────────────────

pub const VAULT_OVERVIEW: &str = "An overview of the vault: how many shards and words \
it has, its tags, the most linked shards, the words written each day lately, \
and whether it's backed up to GitHub.";

/// Days of writing and shards of the most linked the overview shows.
const OVERVIEW_DAYS: usize = 14;
const MOST_LINKED: usize = 10;

#[derive(Deserialize, JsonSchema)]
pub struct OverviewParams {}

#[derive(Serialize)]
pub struct Linked {
    path: String,
    links_to_it: i64,
}

#[derive(Serialize)]
pub struct WrittenDay {
    day: String,
    words: i64,
}

#[derive(Serialize)]
pub struct Backup {
    on: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_synced: Option<String>,
    /// Files waiting for the user to pick a version.
    conflicts: Vec<String>,
}

#[derive(Serialize)]
pub struct Overview {
    vault: String,
    shards: i64,
    words: i64,
    tags: i64,
    most_linked: Vec<Linked>,
    /// Words written each day, newest first, days with none left out.
    writing: Vec<WrittenDay>,
    backup: Backup,
}

pub fn vault_overview(vault: &Vault, _: &Caller, _: OverviewParams) -> ToolResult<Overview> {
    let conn = vault.index()?;
    let key = crate::db::attachments::vault_key(&vault.root);
    let (shards, words) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(word_count), 0) FROM files WHERE vault_path = ?1",
        params![key],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let tags = conn.query_row(
        "SELECT COUNT(DISTINCT t.tag) FROM tags t JOIN files f ON f.id = t.file_id
         WHERE f.vault_path = ?1",
        params![key],
        |row| row.get(0),
    )?;

    // Links name shards by path, so count them by the path they point to.
    let mut stmt = conn.prepare(
        "SELECT l.target_path, COUNT(DISTINCT l.source_file_id) AS sources
         FROM links l JOIN files f ON f.id = l.source_file_id
         WHERE f.vault_path = ?1 AND l.link_type = 'internal'
           AND l.target_path IN (SELECT replace(path, '\\', '/') FROM files WHERE vault_path = ?1)
         GROUP BY l.target_path
         ORDER BY sources DESC, l.target_path
         LIMIT ?2",
    )?;
    let most_linked = stmt
        .query_map(params![key, MOST_LINKED as i64], |row| {
            Ok(Linked {
                path: vault.relative(std::path::Path::new(&row.get::<_, String>(0)?)),
                links_to_it: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let vault_path = vault.root.to_string_lossy();
    let today = crate::db::data::local_today();
    let history = crate::sync::writing::writing_history(
        &vault.sync_root,
        &vault.root,
        &crate::db::data::first_log_day(&today),
    )
    .unwrap_or_default();
    let log = crate::db::data::get_writing_log(&conn, &vault_path, &today, history.as_ref())?;
    let mut days: Vec<WrittenDay> = Vec::new();
    for entry in log.entries.iter().rev() {
        if let Some(day) = days.last_mut().filter(|day| day.day == entry.day) {
            day.words += entry.words;
            continue;
        }
        if days.len() == OVERVIEW_DAYS {
            break;
        }
        days.push(WrittenDay {
            day: entry.day.clone(),
            words: entry.words,
        });
    }
    days.retain(|day| day.words > 0);

    let record = crate::sync::state::find_record(&vault.sync_root, &vault.root)?;
    let backup = Backup {
        on: record.as_ref().is_some_and(|record| record.sync_enabled),
        last_synced: record.as_ref().and_then(|record| record.last_sync_at).map(local_date),
        conflicts: record
            .map(|record| record.conflicts.into_iter().map(|c| c.path).collect())
            .unwrap_or_default(),
    };

    Ok(Overview {
        vault: vault
            .root
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        shards,
        words,
        tags,
        most_linked,
        writing: days,
        backup,
    })
}
