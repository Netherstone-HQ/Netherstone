//! Tags: the files that have them, and the text around each one.

use super::{EXCERPT_AFTER, EXCERPT_BEFORE};
use crate::db::attachments::vault_key;
use crate::markdown_text::{TextBlock, TextPart, excerpt};
use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

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

/// Every file of the vault at `vault_path` with at least one tag, newest
/// first, with the text around each tag's first appearance as the indexer
/// stored it.
pub fn get_tagged_files(conn: &Connection, vault_path: &Path) -> Result<Vec<TaggedFile>, String> {
    let vault = vault_key(vault_path);
    let mut tags_by_file: HashMap<i64, Vec<TagExcerpt>> = HashMap::new();
    let mut stmt = conn
        .prepare(
            "SELECT t.file_id, t.tag, t.excerpt FROM tags t
             JOIN files f ON f.id = t.file_id
             WHERE f.vault_path = ?1
             ORDER BY t.file_id, t.position, t.tag",
        )
        .map_err(|e| format!("Failed to prepare tags query: {}", e))?;
    let rows = stmt
        .query_map(params![vault], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query tags: {}", e))?;
    for row in rows {
        let (file_id, tag, excerpt) = row.map_err(|e| format!("Failed to read tag: {}", e))?;
        let excerpt = excerpt.and_then(|json| serde_json::from_str(&json).ok());
        tags_by_file
            .entry(file_id)
            .or_default()
            .push(TagExcerpt { tag, excerpt });
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, path, name, last_modified
             FROM files
             WHERE vault_path = ?1 AND id IN (SELECT file_id FROM tags)
             ORDER BY last_modified DESC, name ASC",
        )
        .map_err(|e| format!("Failed to prepare tagged files query: {}", e))?;

    let files = stmt
        .query_map(params![vault], |row| {
            let file_id: i64 = row.get(0)?;
            Ok(TaggedFile {
                path: row.get(1)?,
                name: row.get(2)?,
                last_modified: row.get(3)?,
                tags: tags_by_file.remove(&file_id).unwrap_or_default(),
            })
        })
        .map_err(|e| format!("Failed to query tagged files: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect tagged files: {}", e))?;

    Ok(files)
}

/// Pairs each tag with the text around its first appearance, ordered by where
/// that is. Tags that can't be found go last, alphabetically.
pub(crate) fn locate_tags(blocks: &[TextBlock], tags: Vec<String>) -> Vec<TagExcerpt> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::queries::shown;
    use crate::markdown_text::text_blocks;

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
    fn lists_tagged_files_newest_first() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        for (id, name, modified) in [(1, "old.md", 100), (2, "new.md", 200), (3, "plain.md", 300)] {
            conn.execute(
                "INSERT INTO files (id, vault_path, path, name, last_modified, last_indexed, content_hash) VALUES (?1, '/v', ?2, ?2, ?3, ?3, '')",
                params![id, name, modified],
            )
            .unwrap();
        }
        for (file_id, tag, position, excerpt) in [
            (
                1,
                "ideas",
                0,
                Some(r##"[{"text":"Old ","highlight":false},{"text":"#ideas","highlight":true}]"##),
            ),
            (2, "work", 1, None),
            (
                2,
                "ideas",
                0,
                Some(r##"[{"text":"New ","highlight":false},{"text":"#ideas","highlight":true}]"##),
            ),
        ] {
            conn.execute(
                "INSERT INTO tags (file_id, tag, position, excerpt) VALUES (?1, ?2, ?3, ?4)",
                params![file_id, tag, position, excerpt],
            )
            .unwrap();
        }

        let files = get_tagged_files(&conn, Path::new("/v")).unwrap();
        let names: Vec<_> = files.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["new.md", "old.md"]);
        assert_eq!(files[0].last_modified, 200);
        let tags: Vec<_> = files[0].tags.iter().map(|t| t.tag.as_str()).collect();
        assert_eq!(tags, ["ideas", "work"]);
        assert_eq!(
            shown(files[0].tags[0].excerpt.as_ref().unwrap()),
            "New [#ideas]"
        );
        assert_eq!(files[0].tags[1].excerpt, None);
    }

    #[test]
    fn stores_tag_excerpts_when_a_file_is_indexed() {
        let vault =
            std::env::temp_dir().join(format!("netherstone-tag-excerpts-{}", std::process::id()));
        std::fs::create_dir_all(&vault).unwrap();
        let file = vault.join("Monday.md");
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();

        std::fs::write(
            &file,
            "# Monday\n\nRead a **chapter** #reading\n\nCall Sam #todo",
        )
        .unwrap();
        crate::db::indexer::index_file(&conn, &vault, &file).unwrap();
        // Re-indexing replaces what was stored.
        std::fs::write(
            &file,
            "# Monday\n\nCall Sam #todo\n\nRead a **chapter** #reading",
        )
        .unwrap();
        crate::db::indexer::index_file(&conn, &vault, &file).unwrap();
        // The view reads only what the index stored.
        conn.execute("DELETE FROM fts_search", []).unwrap();

        let files = get_tagged_files(&conn, &vault).unwrap();
        let tags: Vec<_> = files[0]
            .tags
            .iter()
            .map(|t| (t.tag.as_str(), shown(t.excerpt.as_ref().unwrap())))
            .collect();
        assert_eq!(
            tags,
            [
                ("todo", "Call Sam [#todo]".to_string()),
                ("reading", "Read a chapter [#reading]".to_string()),
            ]
        );
        std::fs::remove_dir_all(&vault).unwrap();
    }
}
