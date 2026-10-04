use rusqlite::{Connection, params};
use std::collections::HashSet;
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

fn resolve_mention_target(target: &str) -> String {
    let raw_target = target.strip_prefix("mention:").unwrap_or(target).trim();
    if raw_target.is_empty() {
        return String::new();
    }

    let decoded = decode(raw_target)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| raw_target.to_string());

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
        let link_type_str = match link.link_type {
            LinkType::Mention => "mention",
            LinkType::Internal => "internal",
            LinkType::External => "external",
            LinkType::Email => "email",
            LinkType::Phone => "phone",
            LinkType::Anchor => "anchor",
            LinkType::Other => "other",
        };

        let mut final_target = link.target.clone();

        match link.link_type {
            LinkType::Mention => {
                final_target = resolve_mention_target(&link.target);
            }
            LinkType::Internal => {
                let cleaned = strip_link_target(&link.target).trim();
                if !cleaned.is_empty()
                    && !cleaned.starts_with('/')
                    && !is_absolute_path_like(cleaned)
                {
                    if let Some(parent) = file_path.parent() {
                        let resolved = parent.join(cleaned);
                        let normalized = normalize_relative_path(&resolved);
                        final_target = normalize_path(&normalized.to_string_lossy());
                    }
                } else {
                    final_target = normalize_path(cleaned);
                }
            }
            LinkType::External
            | LinkType::Email
            | LinkType::Phone
            | LinkType::Anchor
            | LinkType::Other => {
                final_target = strip_link_target(&link.target).trim().to_string();
            }
        }

        let is_valid = normalize_link_validity(link.link_type, &link.target, &final_target);

        conn.execute(
            "INSERT INTO links (source_file_id, target_path, link_text, link_type, is_valid) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![file_id, final_target, link.text, link_type_str, if is_valid { 1 } else { 0 }],
        )
        .map_err(|e| format!("Failed to insert link: {}", e))?;
    }

    // Insert tags (deduplicated)
    let unique_tags: HashSet<String> = parsed.tags.into_iter().collect();
    for tag in unique_tags {
        conn.execute(
            "INSERT INTO tags (file_id, tag) VALUES (?1, ?2)",
            params![file_id, tag],
        )
        .map_err(|e| format!("Failed to insert tag: {}", e))?;
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
