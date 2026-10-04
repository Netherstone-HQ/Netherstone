use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Debug, Serialize)]
pub struct TagInfo {
    pub tag: String,
    pub count: usize,
}

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub path: String,
    pub name: String,
}

#[derive(Debug, Serialize)]
pub struct Backlink {
    pub path: String,
    pub name: String,
    pub snippet: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileMetadata {
    pub path: String,
    pub name: String,
    pub created_at: i64,
    pub last_modified: i64,
    pub last_indexed: i64,
    pub word_count: i64,
    pub line_count: i64,
    pub character_count: i64,
    pub file_size: i64,
    pub outbound_link_count: i64,
    pub tag_count: i64,
}

/// Search files using FTS5 full-text search.
///
/// Returns matching files with text snippets, ordered by relevance.
pub fn search_files(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    eprintln!("[Netherstone] Searching for: '{}'", query);

    if query.trim().is_empty() {
        return Ok(Vec::new());
    }

    // Add prefix matching (*) to each word for better search results
    // e.g., "auto save" becomes "auto* save*"
    let fts_query = query
        .split_whitespace()
        .map(|word| format!("{}*", word))
        .collect::<Vec<_>>()
        .join(" ");

    eprintln!("[Netherstone] FTS5 query: '{}'", fts_query);

    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.name, snippet(fts_search, 2, '<mark>', '</mark>', '...', 32) as snippet, rank
             FROM fts_search
             INNER JOIN files f ON fts_search.rowid = f.id
             WHERE fts_search MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to prepare search query: {}", e))?;

    let results = stmt
        .query_map(params![fts_query, limit], |row| {
            Ok(SearchResult {
                path: row.get(0)?,
                name: row.get(1)?,
                snippet: row.get(2)?,
                rank: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to execute search: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect search results: {}", e))?;

    eprintln!("[Netherstone] Found {} search results", results.len());
    Ok(results)
}

fn normalize_path(path: &str) -> String {
    path.replace("\\", "/")
}

/// Get all tags in the vault with their file counts.
///
/// Returns tags sorted by count (descending), then alphabetically.
pub fn get_all_tags(conn: &Connection) -> Result<Vec<TagInfo>, String> {
    eprintln!("[Netherstone] Querying all tags");

    let mut stmt = conn
        .prepare(
            "SELECT tag, COUNT(*) as count
             FROM tags
             GROUP BY tag
             ORDER BY count DESC, tag ASC",
        )
        .map_err(|e| format!("Failed to prepare tags query: {}", e))?;

    let tags = stmt
        .query_map([], |row| {
            Ok(TagInfo {
                tag: row.get(0)?,
                count: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to query tags: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect tags: {}", e))?;

    eprintln!("[Netherstone] Found {} unique tags", tags.len());
    Ok(tags)
}

/// Get all files that contain a specific tag.
///
/// Returns files sorted alphabetically by name.
pub fn get_files_by_tag(conn: &Connection, tag: &str) -> Result<Vec<FileInfo>, String> {
    eprintln!("[Netherstone] Querying files with tag: {}", tag);

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT f.path, f.name
             FROM files f
             INNER JOIN tags t ON f.id = t.file_id
             WHERE t.tag = ?1
             ORDER BY f.name ASC",
        )
        .map_err(|e| format!("Failed to prepare files by tag query: {}", e))?;

    let files = stmt
        .query_map(params![tag], |row| {
            Ok(FileInfo {
                path: row.get(0)?,
                name: row.get(1)?,
            })
        })
        .map_err(|e| format!("Failed to query files by tag: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect files: {}", e))?;

    eprintln!(
        "[Netherstone] Found {} files with tag '{}'",
        files.len(),
        tag
    );
    Ok(files)
}

/// Get all files that link to the specified file (backlinks).
pub fn get_backlinks(conn: &Connection, current_file_path: &str) -> Result<Vec<Backlink>, String> {
    eprintln!(
        "[Netherstone] Querying backlinks for: {}",
        current_file_path
    );

    let current_path = normalize_path(current_file_path);

    let current_file = Path::new(&current_path);
    let stem = current_file
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let name = current_file
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("");

    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT f.path, f.name, l.link_text
             FROM links l
             INNER JOIN files f ON l.source_file_id = f.id
             WHERE
                (l.link_type = 'internal' AND (LOWER(l.target_path) = LOWER(?1) OR LOWER(l.target_path || '.md') = LOWER(?1)))
             OR
                (l.link_type = 'mention' AND (
                    LOWER(REPLACE(l.target_path, '\\', '/')) = LOWER(?1)
                    OR LOWER(l.target_path) = LOWER(?2)
                    OR LOWER(l.target_path) = LOWER(?3)
                ))
             ORDER BY f.name ASC",
        )
        .map_err(|e| format!("Failed to prepare backlinks query: {}", e))?;

    let backlinks = stmt
        .query_map(params![current_path, stem, name], |row| {
            Ok(Backlink {
                path: row.get(0)?,
                name: row.get(1)?,
                snippet: row.get(2)?,
            })
        })
        .map_err(|e| format!("Failed to query backlinks: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect backlinks: {}", e))?;

    eprintln!("[Netherstone] Found {} backlinks", backlinks.len());
    Ok(backlinks)
}

/// Get indexed metadata for a specific file.
///
/// Returns the persisted file stats and timestamps used by the editor sidebar.
pub fn get_file_metadata(
    conn: &Connection,
    file_path: &str,
) -> Result<Option<FileMetadata>, String> {
    eprintln!("[Netherstone] Querying file metadata: {}", file_path);

    conn.query_row(
        "SELECT
             f.path,
             f.name,
             f.created_at,
             f.last_modified,
             f.last_indexed,
             f.word_count,
             f.line_count,
             f.character_count,
             f.file_size,
             (SELECT COUNT(*) FROM links l WHERE l.source_file_id = f.id) AS outbound_link_count,
             (SELECT COUNT(*) FROM tags t WHERE t.file_id = f.id) AS tag_count
         FROM files f
         WHERE f.path = ?1
         LIMIT 1",
        params![file_path],
        |row| {
            Ok(FileMetadata {
                path: row.get(0)?,
                name: row.get(1)?,
                created_at: row.get(2)?,
                last_modified: row.get(3)?,
                last_indexed: row.get(4)?,
                word_count: row.get(5)?,
                line_count: row.get(6)?,
                character_count: row.get(7)?,
                file_size: row.get(8)?,
                outbound_link_count: row.get(9)?,
                tag_count: row.get(10)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to query file metadata: {}", e))
}
