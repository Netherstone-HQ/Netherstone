//! Backlinks: the files that link to or mention a shard, and the text
//! around each link.

use super::{EXCERPT_AFTER, EXCERPT_BEFORE};
use crate::db::attachments::vault_key;
use crate::db::indexer::resolve_link_target;
use crate::db::parser::{LinkType, classify_link_target};
use crate::markdown_text::{TextPart, excerpt, text_blocks};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct Backlink {
    pub path: String,
    pub name: String,
    /// The text around the file's first link to the shard, with the link
    /// highlighted.
    pub excerpt: Option<Vec<TextPart>>,
}

fn normalize_path(path: &str) -> String {
    path.replace("\\", "/")
}

/// A shard as the links to it name it.
pub(crate) struct LinkedShard {
    /// With forward slashes.
    path: String,
    name: String,
    stem: String,
}

impl LinkedShard {
    pub(crate) fn new(path: &str) -> Self {
        let path = normalize_path(path);
        let file = Path::new(&path);
        let part = |part: Option<&std::ffi::OsStr>| {
            part.and_then(|p| p.to_str()).unwrap_or("").to_string()
        };
        Self {
            name: part(file.file_name()),
            stem: part(file.file_stem()),
            path,
        }
    }

    /// Whether a link whose target the `links` table stores as `target`
    /// points here: an internal link by its path, with or without `.md`, or
    /// a mention by its path or the shard's name. Case is ignored.
    pub(crate) fn is_target(&self, link_type: LinkType, target: &str) -> bool {
        let same = |a: &str, b: &str| a.eq_ignore_ascii_case(b);
        match link_type {
            LinkType::Internal => {
                same(target, &self.path) || same(&format!("{target}.md"), &self.path)
            }
            LinkType::Mention => {
                same(&normalize_path(target), &self.path)
                    || same(target, &self.stem)
                    || same(target, &self.name)
            }
            _ => false,
        }
    }
}

/// A file that links to or mentions a shard, before the text around the
/// link is read.
pub struct BacklinkSource {
    id: i64,
    path: String,
    name: String,
}

/// Every file of the vault at `vault_path` that links to or mentions the
/// shard at `file_path`, by name.
pub fn backlink_sources(
    conn: &Connection,
    vault_path: &Path,
    file_path: &str,
) -> Result<Vec<BacklinkSource>, String> {
    let shard = LinkedShard::new(file_path);
    // Every target `is_target` can match, so the target index finds the
    // links and `is_target` stays the rule.
    let without_md = shard
        .path
        .len()
        .checked_sub(".md".len())
        .and_then(|end| Some((end, shard.path.get(end..)?)))
        .filter(|(_, extension)| extension.eq_ignore_ascii_case(".md"))
        .map(|(end, _)| &shard.path[..end]);

    let mut stmt = conn
        .prepare(
            // Without INDEXED BY, SQLite may start from the vault's files
            // and read all their links.
            "SELECT f.id, f.path, f.name, l.link_type, l.target_path
             FROM links l INDEXED BY idx_links_target_nocase
             JOIN files f ON f.id = l.source_file_id
             WHERE l.target_path COLLATE NOCASE IN (?2, ?3, ?4, ?5)
               AND l.link_type IN ('internal', 'mention') AND f.vault_path = ?1",
        )
        .map_err(|e| format!("Failed to prepare links query: {}", e))?;
    let links = stmt
        .query_map(
            params![
                vault_key(vault_path),
                shard.path,
                without_md,
                shard.stem,
                shard.name
            ],
            |row| {
                Ok((
                    BacklinkSource {
                        id: row.get(0)?,
                        path: row.get(1)?,
                        name: row.get(2)?,
                    },
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|e| format!("Failed to query links: {}", e))?;
    let mut seen = HashSet::new();
    let mut sources = Vec::new();
    for link in links {
        let (source, link_type, target) =
            link.map_err(|e| format!("Failed to read link: {}", e))?;
        let link_type = if link_type == LinkType::Mention.as_str() {
            LinkType::Mention
        } else {
            LinkType::Internal
        };
        if shard.is_target(link_type, &target) && seen.insert(source.id) {
            sources.push(source);
        }
    }
    sources.sort_by_cached_key(|source| (source.name.to_lowercase(), source.path.clone()));
    Ok(sources)
}

/// The backlinks from `sources` (from [`backlink_sources`] for the shard at
/// `file_path`), each with the text around its first link to the shard.
pub fn backlinks_from(
    conn: &Connection,
    file_path: &str,
    sources: Vec<BacklinkSource>,
) -> Result<Vec<Backlink>, String> {
    let shard = LinkedShard::new(file_path);
    let mut stmt = conn
        .prepare("SELECT content FROM fts_search WHERE rowid = ?1")
        .map_err(|e| format!("Failed to prepare backlinks query: {}", e))?;
    sources
        .into_iter()
        .map(|source| {
            let content = stmt
                .query_row(params![source.id], |row| row.get::<_, Option<String>>(0))
                .optional()
                .map_err(|e| format!("Failed to query backlinks: {}", e))?
                .flatten();
            Ok(Backlink {
                excerpt: link_excerpt(&shard, &source.path, content.as_deref().unwrap_or("")),
                name: source.name,
                path: source.path,
            })
        })
        .collect()
}

/// Every file of the vault at `vault_path` that links to or mentions the
/// shard at `file_path`, by name, with the text around its first link to it.
pub fn get_backlinks(
    conn: &Connection,
    vault_path: &Path,
    file_path: &str,
) -> Result<Vec<Backlink>, String> {
    backlinks_from(
        conn,
        file_path,
        backlink_sources(conn, vault_path, file_path)?,
    )
}

/// The text around the first link to `shard` in `content`, the Markdown of
/// the file at `source`, with the link highlighted.
fn link_excerpt(shard: &LinkedShard, source: &str, content: &str) -> Option<Vec<TextPart>> {
    text_blocks(content).iter().find_map(|block| {
        let (link, _) = block.links.iter().find(|(_, to)| {
            let link_type = classify_link_target(to);
            shard.is_target(
                link_type,
                &resolve_link_target(link_type, to, Path::new(source)),
            )
        })?;
        Some(excerpt(
            &block.text,
            std::slice::from_ref(link),
            EXCERPT_BEFORE,
            EXCERPT_AFTER,
        ))
    })
}

/// The indexed files of the vault at `vault_path` holding a link or mention
/// to any of `shards`, as their paths. The index is only as current as the
/// last pass; a file edited since may be missing.
pub fn files_linking_to_any(
    conn: &Connection,
    vault_path: &Path,
    shards: &[LinkedShard],
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT f.path, l.link_type, l.target_path FROM links l
             JOIN files f ON f.id = l.source_file_id
             WHERE f.vault_path = ?1 AND l.link_type IN ('internal', 'mention')",
        )
        .map_err(|e| format!("Failed to prepare links query: {}", e))?;
    let rows = stmt
        .query_map(params![vault_key(vault_path)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query links: {}", e))?;

    let mut sources: Vec<String> = Vec::new();
    for row in rows {
        let (source, link_type, target) = row.map_err(|e| format!("Failed to read link: {}", e))?;
        let link_type = if link_type == LinkType::Mention.as_str() {
            LinkType::Mention
        } else {
            LinkType::Internal
        };
        if shards
            .iter()
            .any(|shard| shard.is_target(link_type, &target))
            && !sources.contains(&source)
        {
            sources.push(source);
        }
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::queries::get_file_metadata;
    use crate::db::queries::shown;

    #[test]
    fn lists_files_linking_to_a_shard_with_the_linking_line() {
        let vault =
            std::env::temp_dir().join(format!("netherstone-linked-from-{}", std::process::id()));
        std::fs::create_dir_all(vault.join("Work")).unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        for (name, content) in [
            ("Work/Plan.md", "# Plan #ideas #work\n\nGoals."),
            (
                "Diary.md",
                "# Monday\n\nMet [Sam](mention:Sam.md).\n\nPicked up where [Plan](mention:Plan.md) left off.",
            ),
            (
                "Work/Notes.md",
                "See [the plan](./Plan.md#goals) for details, or [Plan](https://plan.example).",
            ),
            (
                "Other.md",
                "Nothing about it, just [a site](https://plan.example).",
            ),
        ] {
            let path = vault.join(name);
            std::fs::write(&path, content).unwrap();
            crate::db::indexer::index_file(&conn, &vault, &path).unwrap();
        }

        let plan = vault.join("Work/Plan.md").to_string_lossy().into_owned();
        let backlinks = get_backlinks(&conn, &vault, &plan).unwrap();
        let found: Vec<_> = backlinks
            .iter()
            .map(|b| (b.name.as_str(), shown(b.excerpt.as_ref().unwrap())))
            .collect();
        assert_eq!(
            found,
            [
                ("Diary.md", "Picked up where [Plan] left off.".to_string()),
                (
                    "Notes.md",
                    "See [the plan] for details, or Plan.".to_string()
                ),
            ]
        );

        let details = get_file_metadata(&conn, &plan).unwrap().unwrap();
        assert_eq!(details.tags, ["ideas", "work"]);
        assert_eq!(details.word_count, 4);

        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn lists_files_linking_to_a_shard_with_spaces_in_its_name() {
        let vault =
            std::env::temp_dir().join(format!("netherstone-backlinks-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&vault);
        std::fs::create_dir_all(vault.join("Projects")).unwrap();

        let roadmap = vault.join("Projects/Netherstone roadmap.md");
        std::fs::write(&roadmap, "# Roadmap").unwrap();
        // Other tools percent-encode the space; the editor uses angle brackets.
        for (name, content) in [
            (
                "Encoded.md",
                "See [roadmap](./Projects/Netherstone%20roadmap.md#goals).",
            ),
            (
                "Bracketed.md",
                "See [roadmap](<Projects/Netherstone roadmap.md>).",
            ),
        ] {
            std::fs::write(vault.join(name), content).unwrap();
        }

        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        for name in [
            "Projects/Netherstone roadmap.md",
            "Encoded.md",
            "Bracketed.md",
        ] {
            crate::db::indexer::index_file(&conn, &vault, &vault.join(name)).unwrap();
        }

        let backlinks = get_backlinks(&conn, &vault, &roadmap.to_string_lossy()).unwrap();
        let names: Vec<_> = backlinks.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["Bracketed.md", "Encoded.md"]);

        let _ = std::fs::remove_dir_all(&vault);
    }
}
