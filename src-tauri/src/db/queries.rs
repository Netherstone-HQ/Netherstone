use crate::markdown_text::{BlockKind, TextBlock, TextPart, excerpt, text_blocks, word_matches};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::path::Path;

/// Characters an excerpt keeps before and after what it highlights.
const EXCERPT_BEFORE: usize = 60;
const EXCERPT_AFTER: usize = 200;

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    /// The text around the words searched for, which are highlighted.
    pub snippet: Vec<TextPart>,
    pub rank: f64,
}

#[derive(Debug, Serialize)]
pub struct TaggedFile {
    pub path: String,
    pub name: String,
    pub last_modified: i64,
    /// In the order they first appear in the file.
    pub tags: Vec<TagExcerpt>,
}

#[derive(Debug, Serialize)]
pub struct TagExcerpt {
    pub tag: String,
    /// The text around the tag's first appearance, with the tag highlighted.
    pub excerpt: Option<Vec<TextPart>>,
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
    let terms: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|term| !term.is_empty())
        .map(str::to_lowercase)
        .collect();

    eprintln!("[Netherstone] FTS5 query: '{}'", fts_query);

    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.name, fts_search.content, rank
             FROM fts_search
             INNER JOIN files f ON fts_search.rowid = f.id
             WHERE fts_search MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| format!("Failed to prepare search query: {}", e))?;

    let results = stmt
        .query_map(params![fts_query, limit], |row| {
            let content: String = row.get(2)?;
            Ok(SearchResult {
                path: row.get(0)?,
                name: row.get(1)?,
                snippet: search_snippet(&content, &terms),
                rank: row.get(3)?,
            })
        })
        .map_err(|e| format!("Failed to execute search: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect search results: {}", e))?;

    eprintln!("[Netherstone] Found {} search results", results.len());
    Ok(results)
}

/// The block matching the most search terms, around its first match. With no
/// match in the text (the name matched), the start of the first non-heading
/// block.
fn search_snippet(content: &str, terms: &[String]) -> Vec<TextPart> {
    let blocks = text_blocks(content);
    let best = blocks
        .iter()
        .enumerate()
        .filter_map(|(index, block)| {
            let matches = word_matches(&block.text, terms);
            let found = terms
                .iter()
                .filter(|term| {
                    matches.iter().any(|m| {
                        block.text[m.clone()]
                            .to_lowercase()
                            .starts_with(term.as_str())
                    })
                })
                .count();
            (found > 0).then_some((index, found, block, matches))
        })
        // The earliest of the blocks with the most terms.
        .max_by_key(|(index, found, ..)| (*found, Reverse(*index)));

    match best {
        Some((_, _, block, matches)) => {
            excerpt(&block.text, &matches, EXCERPT_BEFORE, EXCERPT_AFTER)
        }
        None => blocks
            .iter()
            .find(|block| !matches!(block.kind, BlockKind::Heading { .. }))
            .map(|block| excerpt(&block.text, &[], EXCERPT_BEFORE, EXCERPT_AFTER))
            .unwrap_or_default(),
    }
}

fn normalize_path(path: &str) -> String {
    path.replace("\\", "/")
}

/// Every file with at least one tag, newest first, with the text around each
/// tag's first appearance.
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
                tags: locate_tags(&text_blocks(content.as_deref().unwrap_or("")), tags),
            })
        })
        .map_err(|e| format!("Failed to query tagged files: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect tagged files: {}", e))?;

    Ok(files)
}

/// Pairs each tag with the text around its first appearance, ordered by where
/// that is. Tags that can't be found go last, alphabetically.
fn locate_tags(blocks: &[TextBlock], tags: Vec<String>) -> Vec<TagExcerpt> {
    let mut located: Vec<((usize, usize), TagExcerpt)> = tags
        .into_iter()
        .map(|tag| {
            let found = blocks.iter().enumerate().find_map(|(index, block)| {
                let (at, _) = block.tags.iter().find(|(_, t)| *t == tag)?;
                Some(((index, *at), block))
            });
            let position = found.map_or((usize::MAX, 0), |(position, _)| position);
            let excerpt = found.map(|((_, at), block)| {
                let highlight = at..at + 1 + tag.len();
                excerpt(&block.text, &[highlight], EXCERPT_BEFORE, EXCERPT_AFTER)
            });
            (position, TagExcerpt { tag, excerpt })
        })
        .collect();
    located.sort_by(|(a, x), (b, y)| a.cmp(b).then_with(|| x.tag.cmp(&y.tag)));
    located.into_iter().map(|(_, tag)| tag).collect()
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

    fn shown(parts: &[TextPart]) -> String {
        parts
            .iter()
            .map(|p| {
                if p.highlight {
                    format!("[{}]", p.text)
                } else {
                    p.text.clone()
                }
            })
            .collect()
    }

    #[test]
    fn orders_tags_by_first_appearance() {
        let blocks = text_blocks(
            "# Monday\n\nRead a **chapter** #reading\n- [ ] Call [Sam](mention:Sam.md) #todo #reading",
        );
        let tags = locate_tags(
            &blocks,
            vec!["todo".into(), "missing".into(), "reading".into()],
        );

        let names: Vec<_> = tags.iter().map(|t| t.tag.as_str()).collect();
        assert_eq!(names, ["reading", "todo", "missing"]);
        assert_eq!(
            shown(tags[0].excerpt.as_ref().unwrap()),
            "Read a chapter [#reading]"
        );
        assert_eq!(
            shown(tags[1].excerpt.as_ref().unwrap()),
            "Call Sam [#todo] #reading"
        );
        assert_eq!(tags[2].excerpt, None);
    }

    #[test]
    fn snippets_show_the_block_with_the_most_search_terms() {
        let content =
            "# Trip\n\nPack the bags.\n\nBook the **train** for the trip.\n\nTrain snacks.";
        let terms = ["train".to_string(), "trip".to_string()];
        assert_eq!(
            shown(&search_snippet(content, &terms)),
            "Book the [train] for the [trip]."
        );
    }

    #[test]
    fn snippets_fall_back_to_the_first_paragraph() {
        let content = "# Trip\n\nPack the bags.";
        assert_eq!(
            shown(&search_snippet(content, &["zebra".to_string()])),
            "Pack the bags."
        );
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
        assert_eq!(
            shown(files[0].tags[0].excerpt.as_ref().unwrap()),
            "New [#ideas]"
        );
    }
}
