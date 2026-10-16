use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    pub snippet: String,
    pub rank: f64,
}

#[derive(Debug, Serialize)]
pub struct TaggedFile {
    pub path: String,
    pub name: String,
    pub last_modified: i64,
    /// In the order they first appear in the file.
    pub tags: Vec<TagLine>,
}

#[derive(Debug, Serialize)]
pub struct TagLine {
    pub tag: String,
    /// The first line that contains `#tag`, trimmed.
    pub line: Option<String>,
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

/// Every file with at least one tag, newest first, with the line each tag
/// first appears on.
pub fn get_tagged_files(conn: &Connection) -> Result<Vec<TaggedFile>, String> {
    let mut tags_by_file: HashMap<i64, Vec<String>> = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT file_id, tag FROM tags")
        .map_err(|e| format!("Failed to prepare tags query: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to query tags: {}", e))?;
    for row in rows {
        let (file_id, tag) = row.map_err(|e| format!("Failed to read tag: {}", e))?;
        tags_by_file.entry(file_id).or_default().push(tag);
    }

    let mut stmt = conn
        .prepare(
            "SELECT f.id, f.path, f.name, f.last_modified, s.content
             FROM files f
             LEFT JOIN fts_search s ON s.rowid = f.id
             WHERE f.id IN (SELECT file_id FROM tags)
             ORDER BY f.last_modified DESC, f.name ASC",
        )
        .map_err(|e| format!("Failed to prepare tagged files query: {}", e))?;

    let files = stmt
        .query_map([], |row| {
            let file_id: i64 = row.get(0)?;
            let content: Option<String> = row.get(4)?;
            let tags = tags_by_file.remove(&file_id).unwrap_or_default();
            Ok(TaggedFile {
                path: row.get(1)?,
                name: row.get(2)?,
                last_modified: row.get(3)?,
                tags: locate_tags(content.as_deref().unwrap_or(""), tags),
            })
        })
        .map_err(|e| format!("Failed to query tagged files: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect tagged files: {}", e))?;

    Ok(files)
}

/// Pairs each tag with the first line it appears on, ordered by where that is.
/// Tags whose line can't be found go last, alphabetically.
fn locate_tags(content: &str, tags: Vec<String>) -> Vec<TagLine> {
    let mut located: Vec<((usize, usize), TagLine)> = tags
        .into_iter()
        .map(|tag| {
            let found = content.lines().enumerate().find_map(|(index, line)| {
                find_tag_in_line(line, &tag).map(|column| ((index, column), line.trim()))
            });
            let position = found.map_or((usize::MAX, 0), |(position, _)| position);
            let line = found.map(|(_, line)| line.to_string());
            (position, TagLine { tag, line })
        })
        .collect();
    located.sort_by(|(a, x), (b, y)| a.cmp(b).then_with(|| x.tag.cmp(&y.tag)));
    located.into_iter().map(|(_, tag_line)| tag_line).collect()
}

/// Where `#tag` starts in `line` as a whole tag: not inside a longer word, and
/// followed only by punctuation before the next space, as the parser reads it.
fn find_tag_in_line(line: &str, tag: &str) -> Option<usize> {
    let needle = format!("#{}", tag);
    line.match_indices(&needle)
        .map(|(start, _)| start)
        .find(|&start| {
            let starts_word = line[..start]
                .chars()
                .next_back()
                .is_none_or(|c| c.is_whitespace() || (c.is_ascii_punctuation() && c != '#'));
            let rest = &line[start + needle.len()..];
            let word_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            starts_word && rest[..word_end].chars().all(|c| c.is_ascii_punctuation())
        })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_whole_tags_only() {
        assert_eq!(find_tag_in_line("Plans #ideas", "ideas"), Some(6));
        assert_eq!(find_tag_in_line("**#ideas**, later", "ideas"), Some(2));
        assert_eq!(find_tag_in_line("#ideas-old #ideas.", "ideas"), Some(11));
        assert_eq!(find_tag_in_line("#ideasbook", "ideas"), None);
        assert_eq!(find_tag_in_line("issue#ideas", "ideas"), None);
    }

    #[test]
    fn orders_tags_by_first_appearance() {
        let content = "# Monday\n\nRead a chapter #reading\n- [ ] Call back #todo #reading";
        let tags = locate_tags(
            content,
            vec!["todo".into(), "missing".into(), "reading".into()],
        );

        let names: Vec<_> = tags.iter().map(|t| t.tag.as_str()).collect();
        assert_eq!(names, ["reading", "todo", "missing"]);
        assert_eq!(tags[0].line.as_deref(), Some("Read a chapter #reading"));
        assert_eq!(
            tags[1].line.as_deref(),
            Some("- [ ] Call back #todo #reading")
        );
        assert_eq!(tags[2].line, None);
    }

    #[test]
    fn lists_tagged_files_newest_first() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        for (id, name, modified, content, tag) in [
            (1, "old.md", 100, "Old #ideas", Some("ideas")),
            (2, "new.md", 200, "New #ideas", Some("ideas")),
            (3, "plain.md", 300, "No tags here", None),
        ] {
            conn.execute(
                "INSERT INTO files (id, path, name, last_modified, last_indexed, content_hash) VALUES (?1, ?2, ?2, ?3, ?3, '')",
                params![id, name, modified],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO fts_search (rowid, path, name, content) VALUES (?1, ?2, ?2, ?3)",
                params![id, name, content],
            )
            .unwrap();
            if let Some(tag) = tag {
                conn.execute(
                    "INSERT INTO tags (file_id, tag) VALUES (?1, ?2)",
                    params![id, tag],
                )
                .unwrap();
            }
        }

        let files = get_tagged_files(&conn).unwrap();
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["new.md", "old.md"]);
        assert_eq!(files[0].last_modified, 200);
        assert_eq!(files[0].tags[0].line.as_deref(), Some("New #ideas"));
    }
}
