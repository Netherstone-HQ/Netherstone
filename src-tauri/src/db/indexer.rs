use super::queries::locate_tags;
use crate::markdown_text::{has_letter, text_blocks};
use rusqlite::{Connection, OptionalExtension, params};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use urlencoding::decode;

fn normalize_path(path: &str) -> String {
    path.replace("\\", "/")
}

fn normalize_relative_path(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();

    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(part) => normalized.push(part),
            Component::RootDir | Component::Prefix(_) => normalized.push(component.as_os_str()),
        }
    }

    normalized
}

fn strip_link_target(target: &str) -> &str {
    target
        .split('#')
        .next()
        .unwrap_or(target)
        .split('?')
        .next()
        .unwrap_or(target)
}

fn is_absolute_path_like(target: &str) -> bool {
    let bytes = target.as_bytes();
    bytes.get(1) == Some(&b':') || target.starts_with("//") || target.starts_with("\\\\")
}

fn normalize_link_validity(link_type: LinkType, target: &str, resolved_target: &str) -> bool {
    match link_type {
        LinkType::Mention | LinkType::Internal => !resolved_target.trim().is_empty(),
        LinkType::External | LinkType::Email | LinkType::Phone | LinkType::Anchor => {
            !target.trim().is_empty()
        }
        LinkType::Other => false,
    }
}

/// Decodes a percent-encoded link target (`My%20note.md` is `My note.md`),
/// keeping it as written when the decoded bytes aren't valid UTF-8.
fn decode_link_target(target: &str) -> String {
    decode(target)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| target.to_string())
}

/// Resolves an internal link target against the folder of the linking file.
pub(crate) fn resolve_internal_target(file_path: &Path, target: &str) -> String {
    let cleaned = decode_link_target(strip_link_target(target).trim());

    if cleaned.is_empty() || cleaned.starts_with('/') || is_absolute_path_like(&cleaned) {
        return normalize_path(&cleaned);
    }

    match file_path.parent() {
        Some(parent) => {
            let normalized = normalize_relative_path(&parent.join(&cleaned));
            normalize_path(&normalized.to_string_lossy())
        }
        None => target.to_string(),
    }
}

pub(crate) fn resolve_mention_target(target: &str) -> String {
    let raw_target = target.strip_prefix("mention:").unwrap_or(target).trim();
    if raw_target.is_empty() {
        return String::new();
    }

    let decoded = decode_link_target(raw_target);

    let without_suffix =
        decoded
            .rsplit_once('-')
            .map_or(decoded.as_str(), |(candidate, suffix)| {
                if !candidate.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
                    candidate
                } else {
                    decoded.as_str()
                }
            });

    normalize_path(without_suffix)
}

/// Where a link in the file at `file_path` points, as the `links` table stores
/// it: a mention's shard, an internal link's decoded path with forward
/// slashes (resolved from the file's folder when relative), or any other link's
/// address without its `#` or `?` part.
pub fn resolve_link_target(link_type: LinkType, target: &str, file_path: &Path) -> String {
    match link_type {
        LinkType::Mention => resolve_mention_target(target),
        LinkType::Internal => resolve_internal_target(file_path, target),
        LinkType::External
        | LinkType::Email
        | LinkType::Phone
        | LinkType::Anchor
        | LinkType::Other => strip_link_target(target).trim().to_string(),
    }
}

use super::parser::{LinkType, parse_markdown};

/// Index a single markdown file into the database.
///
/// Steps:
/// 1. Read file metadata (created_at, last_modified, file_size, content)
/// 2. Parse markdown to extract links, tags, and editor stats
/// 3. Insert/update file record
/// 4. Insert extracted metadata (links, tags)
/// 5. Update FTS5 search index
pub fn index_file(conn: &Connection, file_path: &Path) -> Result<(), String> {
    let path_str = file_path
        .to_str()
        .ok_or_else(|| "Invalid file path".to_string())?;

    // Read file metadata
    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let last_modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get modified time: {}", e))?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Invalid modified time: {}", e))?
        .as_secs() as i64;

    let created_at = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(last_modified);
    let file_size = metadata.len() as i64;

    // Read file content
    let content = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file content: {}", e))?;

    // Compute content hash for change detection
    let content_hash = format!("{:x}", md5::compute(&content));

    // Parse markdown
    let parsed = parse_markdown(&content);

    let file_name = file_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("unknown");

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    // Check if file already exists in DB
    let existing_file_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM files WHERE path = ?1",
            params![path_str],
            |row| row.get(0),
        )
        .ok();

    let file_id = if let Some(id) = existing_file_id {
        // Update existing file
        conn.execute(
            "UPDATE files SET name = ?1, last_modified = ?2, last_indexed = ?3, content_hash = ?4, word_count = ?5, line_count = ?6, character_count = ?7, file_size = ?8, created_at = ?9 WHERE id = ?10",
            params![
                file_name,
                last_modified,
                now,
                content_hash,
                parsed.word_count as i64,
                parsed.line_count as i64,
                parsed.character_count as i64,
                file_size,
                created_at,
                id
            ],
        )
        .map_err(|e| format!("Failed to update file: {}", e))?;

        // Delete old metadata
        conn.execute("DELETE FROM links WHERE source_file_id = ?1", params![id])
            .map_err(|e| format!("Failed to delete old links: {}", e))?;
        conn.execute("DELETE FROM tags WHERE file_id = ?1", params![id])
            .map_err(|e| format!("Failed to delete old tags: {}", e))?;
        conn.execute("DELETE FROM charts WHERE file_id = ?1", params![id])
            .map_err(|e| format!("Failed to delete old charts: {}", e))?;

        id
    } else {
        // Insert new file
        conn.execute(
            "INSERT INTO files (path, name, last_modified, last_indexed, content_hash, word_count, line_count, character_count, file_size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                path_str,
                file_name,
                last_modified,
                now,
                content_hash,
                parsed.word_count as i64,
                parsed.line_count as i64,
                parsed.character_count as i64,
                file_size,
                created_at
            ],
        )
        .map_err(|e| format!("Failed to insert file: {}", e))?;

        conn.last_insert_rowid()
    };

    // Insert links
    for link in parsed.links {
        let final_target = resolve_link_target(link.link_type, &link.target, file_path);
        let is_valid = normalize_link_validity(link.link_type, &link.target, &final_target);

        conn.execute(
            "INSERT INTO links (source_file_id, target_path, link_text, link_type, is_valid) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![file_id, final_target, link.text, link.link_type.as_str(), if is_valid { 1 } else { 0 }],
        )
        .map_err(|e| format!("Failed to insert link: {}", e))?;
    }

    // Insert tags (deduplicated), with the text around each one
    let unique_tags: HashSet<String> = parsed.tags.into_iter().collect();
    insert_tags(conn, file_id, &content, unique_tags.into_iter().collect())
        .map_err(|e| format!("Failed to insert tag: {}", e))?;

    for title in &parsed.charts {
        conn.execute(
            "INSERT INTO charts (file_id, title) VALUES (?1, ?2)",
            params![file_id, title],
        )
        .map_err(|e| format!("Failed to insert chart: {}", e))?;
    }

    super::attachments::sync_references_for_saved_markdown(conn, path_str, &content)?;

    // Update FTS5 search index
    // FTS5 virtual tables support standard INSERT/UPDATE/DELETE operations
    // For updates, we need to delete the old entry first, then insert the new one
    conn.execute("DELETE FROM fts_search WHERE rowid = ?1", params![file_id])
        .ok(); // Ignore error if row doesn't exist

    conn.execute(
        "INSERT INTO fts_search(rowid, path, name, content) VALUES (?1, ?2, ?3, ?4)",
        params![file_id, path_str, file_name, content],
    )
    .map_err(|e| format!("Failed to insert into search index: {}", e))?;

    Ok(())
}

/// Stores a file's tags in the order they first appear, each with the text
/// around that first appearance, so the Tags view doesn't have to read every
/// tagged file when it opens.
fn insert_tags(
    conn: &Connection,
    file_id: i64,
    content: &str,
    tags: Vec<String>,
) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT INTO tags (file_id, tag, position, excerpt) VALUES (?1, ?2, ?3, ?4)",
    )?;
    for (position, tag) in locate_tags(&text_blocks(content), tags)
        .into_iter()
        .enumerate()
    {
        let excerpt = tag
            .excerpt
            .map(|parts| serde_json::to_string(&parts))
            .transpose()
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        stmt.execute(params![file_id, tag.tag, position as i64, excerpt])?;
    }
    Ok(())
}

/// Fills in positions and excerpts for tags indexed before they were stored,
/// from the text already in the search index.
pub(crate) fn backfill_tag_excerpts(conn: &Connection) -> rusqlite::Result<()> {
    let mut tags_by_file: HashMap<i64, Vec<String>> = HashMap::new();
    {
        let mut stmt = conn.prepare("SELECT file_id, tag FROM tags")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (file_id, tag) = row?;
            tags_by_file.entry(file_id).or_default().push(tag);
        }
    }
    if tags_by_file.is_empty() {
        return Ok(());
    }

    let tx = conn.unchecked_transaction()?;
    for (file_id, tags) in tags_by_file {
        let content: Option<String> = tx
            .query_row(
                "SELECT content FROM fts_search WHERE rowid = ?1",
                params![file_id],
                |row| row.get(0),
            )
            .optional()?;
        tx.execute("DELETE FROM tags WHERE file_id = ?1", params![file_id])?;
        insert_tags(&tx, file_id, content.as_deref().unwrap_or(""), tags)?;
    }
    tx.commit()
}

/// Removes tags without a letter, such as `#3`, indexed before tags needed
/// one; files only drop them when they change otherwise.
pub(crate) fn remove_tags_without_letters(conn: &Connection) -> rusqlite::Result<()> {
    let tags: Vec<String> = conn
        .prepare("SELECT DISTINCT tag FROM tags")?
        .query_map([], |row| row.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    for tag in tags.into_iter().filter(|tag| !has_letter(tag)) {
        conn.execute("DELETE FROM tags WHERE tag = ?1", params![tag])?;
    }
    Ok(())
}

/// Check if a file needs to be re-indexed.
///
/// Returns true if:
/// - File doesn't exist in DB
/// - File's last_modified is newer than last_indexed
pub fn needs_indexing(conn: &Connection, file_path: &Path) -> Result<bool, String> {
    let path_str = file_path
        .to_str()
        .ok_or_else(|| "Invalid file path".to_string())?;

    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;

    let last_modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get modified time: {}", e))?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Invalid modified time: {}", e))?
        .as_secs() as i64;

    let result: Option<i64> = conn
        .query_row(
            "SELECT last_indexed FROM files WHERE path = ?1 AND last_modified >= ?2",
            params![path_str, last_modified],
            |row| row.get(0),
        )
        .ok();

    // Needs indexing if not found or if last_modified is newer
    Ok(result.is_none())
}

/// Remove files from the database that no longer exist on disk.
pub fn prune_deleted_files(conn: &Connection, existing_paths: &[String]) -> Result<usize, String> {
    if existing_paths.is_empty() {
        return Ok(0);
    }

    let placeholders = existing_paths
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let query = format!("DELETE FROM files WHERE path NOT IN ({})", placeholders);

    let params: Vec<&dyn rusqlite::ToSql> = existing_paths
        .iter()
        .map(|p| p as &dyn rusqlite::ToSql)
        .collect();

    let deleted = conn
        .execute(&query, params.as_slice())
        .map_err(|e| format!("Failed to prune deleted files: {}", e))?;

    Ok(deleted)
}
