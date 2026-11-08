//! What the app reads back from the index: search, tags, backlinks and a
//! file's details.

mod links;
mod search;
mod tags;

pub(crate) use links::LinkedShard;
pub use links::{Backlink, backlink_sources, backlinks_from, files_linking_to_any, get_backlinks};
pub use search::{FileFilter, SearchResult, find_files, search_files};
pub(crate) use tags::locate_tags;
pub use tags::{TaggedFile, get_tagged_files};

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

/// Characters an excerpt keeps before and after what it highlights.
const EXCERPT_BEFORE: usize = 60;
const EXCERPT_AFTER: usize = 200;

#[derive(Debug, Serialize)]
pub struct FileMetadata {
    pub created_at: i64,
    pub last_modified: i64,
    pub word_count: i64,
    pub character_count: i64,
    pub file_size: i64,
    /// Alphabetical.
    pub tags: Vec<String>,
}

/// The indexed details of the file at `file_path`, or None if it isn't
/// indexed.
pub fn get_file_metadata(
    conn: &Connection,
    file_path: &str,
) -> Result<Option<FileMetadata>, String> {
    let file = conn
        .query_row(
            "SELECT id, created_at, last_modified, word_count, character_count, file_size
             FROM files
             WHERE path = ?1",
            params![file_path],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    FileMetadata {
                        created_at: row.get(1)?,
                        last_modified: row.get(2)?,
                        word_count: row.get(3)?,
                        character_count: row.get(4)?,
                        file_size: row.get(5)?,
                        tags: Vec::new(),
                    },
                ))
            },
        )
        .optional()
        .map_err(|e| format!("Failed to query file metadata: {}", e))?;
    let Some((file_id, mut metadata)) = file else {
        return Ok(None);
    };

    let mut stmt = conn
        .prepare("SELECT tag FROM tags WHERE file_id = ?1 ORDER BY tag")
        .map_err(|e| format!("Failed to prepare tags query: {}", e))?;
    metadata.tags = stmt
        .query_map(params![file_id], |row| row.get(0))
        .map_err(|e| format!("Failed to query tags: {}", e))?
        .collect::<Result<_, _>>()
        .map_err(|e| format!("Failed to collect tags: {}", e))?;
    Ok(Some(metadata))
}

/// Text parts as a string, with the highlighted ones in brackets.
#[cfg(test)]
fn shown(parts: &[crate::markdown_text::TextPart]) -> String {
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
