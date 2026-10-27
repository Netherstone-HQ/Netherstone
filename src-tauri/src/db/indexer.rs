use super::queries::locate_tags;
use crate::markdown_text::text_blocks;
use rusqlite::{Connection, params};
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

/// A shard as read from disk, ready to index.
struct ShardFile {
    last_modified: i64,
    created_at: i64,
    file_size: i64,
    content: String,
    content_hash: String,
}

fn read_shard(file_path: &Path) -> Result<ShardFile, String> {
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

    let content = std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file content: {}", e))?;

    Ok(ShardFile {
        last_modified,
        created_at,
        file_size: metadata.len() as i64,
        content_hash: format!("{:x}", md5::compute(&content)),
        content,
    })
}

/// Index a single markdown file of the vault at `vault_path` into the
/// database.
///
/// Steps:
/// 1. Read file metadata (created_at, last_modified, file_size, content)
/// 2. Parse markdown to extract links, tags, and editor stats
/// 3. Insert/update file record
/// 4. Insert extracted metadata (links, tags, drawing embeds)
/// 5. Update FTS5 search index
///
/// A shard in another vault inside this one is that vault's, so it's left out.
pub fn index_file(conn: &Connection, vault_path: &Path, file_path: &Path) -> Result<(), String> {
    if crate::sync::state::crosses_into_another_vault(vault_path, file_path) {
        return Ok(());
    }
    store_shard(conn, vault_path, file_path, read_shard(file_path)?)
}

fn store_shard(
    conn: &Connection,
    vault_path: &Path,
    file_path: &Path,
    shard: ShardFile,
) -> Result<(), String> {
    let path_str = file_path
        .to_str()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let ShardFile {
        last_modified,
        created_at,
        file_size,
        content,
        content_hash,
    } = shard;

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
    let vault = super::attachments::vault_key(vault_path);

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
            "UPDATE files SET name = ?1, last_modified = ?2, last_indexed = ?3, content_hash = ?4, word_count = ?5, line_count = ?6, character_count = ?7, file_size = ?8, created_at = ?9, vault_path = ?10 WHERE id = ?11",
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
                vault,
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
        conn.execute("DELETE FROM drawing_embeds WHERE file_id = ?1", params![id])
            .map_err(|e| format!("Failed to delete old drawing embeds: {}", e))?;

        id
    } else {
        // Insert new file
        conn.execute(
            "INSERT INTO files (vault_path, path, name, last_modified, last_indexed, content_hash, word_count, line_count, character_count, file_size, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                vault,
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

    insert_drawing_embeds(conn, file_id, &content)
        .map_err(|e| format!("Failed to insert drawing embed: {}", e))?;

    super::attachments::sync_references_for_saved_markdown(conn, vault_path, path_str, &content)?;

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

/// Stores which drawings the shard `file_id` shows, so finding the shards
/// that show a drawing is a lookup.
pub(super) fn insert_drawing_embeds(conn: &Connection, file_id: i64, content: &str) -> rusqlite::Result<()> {
    let mut stmt = conn.prepare_cached(
        "INSERT OR IGNORE INTO drawing_embeds (file_id, drawing_path) VALUES (?1, ?2)",
    )?;
    for drawing in super::attachments::parse_drawing_embeds(content) {
        stmt.execute(params![file_id, drawing])?;
    }
    Ok(())
}

/// When the file at `file_path` last changed, in seconds, as the index keeps it.
fn modified_secs(file_path: &Path) -> Result<i64, String> {
    let metadata =
        std::fs::metadata(file_path).map_err(|e| format!("Failed to read file metadata: {}", e))?;
    Ok(metadata
        .modified()
        .map_err(|e| format!("Failed to get modified time: {}", e))?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("Invalid modified time: {}", e))?
        .as_secs() as i64)
}

/// Check if a file needs to be re-indexed.
///
/// Returns true if:
/// - File doesn't exist in DB for the vault at `vault_path`
/// - File's last_modified is newer than last_indexed
pub fn needs_indexing(
    conn: &Connection,
    vault_path: &Path,
    file_path: &Path,
) -> Result<bool, String> {
    let path_str = file_path
        .to_str()
        .ok_or_else(|| "Invalid file path".to_string())?;
    let last_modified = modified_secs(file_path)?;

    let result: Option<i64> = conn
        .query_row(
            "SELECT last_indexed FROM files WHERE path = ?1 AND last_modified >= ?2 AND vault_path = ?3",
            params![path_str, last_modified, super::attachments::vault_key(vault_path)],
            |row| row.get(0),
        )
        .ok();

    // Needs indexing if not found or if last_modified is newer
    Ok(result.is_none())
}

/// The shards of the vault at `vault_path` the index holds, by path, with
/// their id and when each had last changed when it was indexed.
fn indexed_shards(conn: &Connection, vault_path: &Path) -> rusqlite::Result<HashMap<String, (i64, i64)>> {
    let mut stmt = conn.prepare("SELECT path, id, last_modified FROM files WHERE vault_path = ?1")?;
    stmt.query_map(params![super::attachments::vault_key(vault_path)], |row| {
        Ok((row.get(0)?, (row.get(1)?, row.get(2)?)))
    })?
    .collect()
}

/// Forgets the indexed shards with these ids, with their search text.
fn forget_ids(conn: &Connection, ids: &[i64]) -> rusqlite::Result<()> {
    // The search text isn't tied to its file, so it goes first.
    let mut search = conn.prepare_cached("DELETE FROM fts_search WHERE rowid = ?1")?;
    let mut files = conn.prepare_cached("DELETE FROM files WHERE id = ?1")?;
    for id in ids {
        search.execute(params![id])?;
        files.execute(params![id])?;
    }
    Ok(())
}

/// What indexing a vault did.
pub struct VaultIndexed {
    /// Every shard in the vault.
    pub paths: Vec<String>,
    pub indexed: usize,
    pub skipped: usize,
    pub errors: usize,
}

/// Indexes the shards of the vault at `vault_path` that changed since they
/// were last indexed, and forgets the ones that are gone or belong to another
/// vault inside it.
pub fn index_vault(conn: &Connection, vault_path: &Path) -> Result<VaultIndexed, String> {
    if !vault_path.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path.display()));
    }

    let mut paths = Vec::new();
    for node in &crate::vault::scan_own_dir(vault_path) {
        crate::vault::collect_file_paths(node, &mut paths);
    }

    // Read once, so a pass over a vault where little changed checks each
    // shard's time on disk only.
    let mut shards = indexed_shards(conn, vault_path).map_err(|e| format!("Failed to read the index: {}", e))?;
    let (mut indexed, mut skipped, mut errors) = (0, 0, 0);
    for path_str in &paths {
        let path = Path::new(path_str);
        let known = shards.remove(path_str).map(|(_, last_modified)| last_modified);
        match modified_secs(path) {
            Ok(modified) if known.is_some_and(|known| known >= modified) => skipped += 1,
            Ok(_) => match index_file(conn, vault_path, path) {
                Ok(()) => indexed += 1,
                Err(e) => {
                    eprintln!("[Netherstone] Failed to index {}: {}", path_str, e);
                    errors += 1;
                }
            },
            Err(e) => {
                eprintln!("[Netherstone] Failed to check {}: {}", path_str, e);
                errors += 1;
            }
        }
    }

    // What's left is this vault's shards that are gone from disk.
    let gone: Vec<i64> = shards.into_values().map(|(id, _)| id).collect();
    if let Err(e) = forget_ids(conn, &gone) {
        eprintln!("[Netherstone] Failed to prune deleted files: {}", e);
    }

    Ok(VaultIndexed {
        paths,
        indexed,
        skipped,
        errors,
    })
}

/// Forgets the indexed shards at `path` or inside it, with their search text,
/// once they're gone from disk: a deleted shard, or a folder moved away.
pub fn forget_path(conn: &Connection, vault_path: &Path, path: &Path) -> Result<usize, String> {
    let path_str = path.to_str().ok_or_else(|| "Invalid file path".to_string())?;
    let inside = format!("{}{}", path_str, std::path::MAIN_SEPARATOR);
    let vault = super::attachments::vault_key(vault_path);
    let matching = "vault_path = ?1 AND (path = ?2 OR substr(path, 1, length(?3)) = ?3)";
    let forget = || -> rusqlite::Result<usize> {
        // The search text isn't tied to its file, so it goes first.
        conn.execute(
            &format!("DELETE FROM fts_search WHERE rowid IN (SELECT id FROM files WHERE {matching})"),
            params![vault, path_str, inside],
        )?;
        conn.execute(
            &format!("DELETE FROM files WHERE {matching}"),
            params![vault, path_str, inside],
        )
    };
    forget().map_err(|e| format!("Failed to forget {}: {}", path_str, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shards_showing(conn: &Connection, drawing: &str) -> Vec<String> {
        let mut stmt = conn
            .prepare(
                "SELECT f.name FROM drawing_embeds d JOIN files f ON f.id = d.file_id
                 WHERE d.drawing_path = ?1 ORDER BY f.name",
            )
            .unwrap();
        stmt.query_map([drawing], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn drawing_embeds_follow_the_shard() {
        let vault = crate::sync::state::tests::temp_dir("indexer-drawings");
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        let a = vault.join("a.md");
        let b = vault.join("b.md");
        std::fs::write(
            &a,
            "Before <img src=\"\" data-excalidraw=\"d/F &amp; co.excalidraw\" /> and \
             <img src=\"x.png\" data-excalidraw=\"Flow.excalidraw\" />\n",
        )
        .unwrap();
        std::fs::write(&b, "<img data-excalidraw=\"d/F & co.excalidraw\" />\n\n`data-excalidraw=\"Flow.excalidraw\"`\n").unwrap();
        index_file(&conn, &vault, &a).unwrap();
        index_file(&conn, &vault, &b).unwrap();

        assert_eq!(shards_showing(&conn, "d/F & co.excalidraw"), ["a.md", "b.md"]);
        assert_eq!(shards_showing(&conn, "Flow.excalidraw"), ["a.md"]);

        std::fs::write(&a, "No drawings now.").unwrap();
        index_file(&conn, &vault, &a).unwrap();
        assert_eq!(shards_showing(&conn, "Flow.excalidraw"), Vec::<String>::new());
        forget_path(&conn, &vault, &b).unwrap();
        assert_eq!(shards_showing(&conn, "d/F & co.excalidraw"), Vec::<String>::new());
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn shards_indexed_before_drawing_embeds_get_theirs() {
        let vault = crate::sync::state::tests::temp_dir("indexer-drawings-fill");
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        let shard = vault.join("a.md");
        std::fs::write(&shard, "<img data-excalidraw=\"Flow.excalidraw\" />\n").unwrap();
        index_file(&conn, &vault, &shard).unwrap();
        conn.execute_batch("DROP TABLE drawing_embeds").unwrap();

        crate::db::schema::init_schema(&conn).unwrap();
        assert_eq!(shards_showing(&conn, "Flow.excalidraw"), ["a.md"]);
        std::fs::remove_dir_all(&vault).unwrap();
    }
}
