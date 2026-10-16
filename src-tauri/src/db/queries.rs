use super::indexer::resolve_link_target;
use super::parser::{LinkType, classify_link_target};
use crate::markdown_text::{BlockKind, TextBlock, TextPart, excerpt, text_blocks, word_matches};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
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
    /// The text around the file's first link to the shard, with the link
    /// highlighted.
    pub excerpt: Option<Vec<TextPart>>,
}

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

/// Search files using FTS5 full-text search.
///
/// Returns matching files with text snippets, ordered by relevance.
pub fn search_files(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    eprintln!("[Netherstone] Searching for: '{}'", query);

    let terms = search_terms(query);
    if terms.is_empty() {
        return Ok(Vec::new());
    }

    // Each term quoted, so nothing typed is read as query syntax, and matched
    // as a prefix: "auto save" becomes "auto"* "save"*.
    let fts_query = terms
        .iter()
        .map(|term| format!("\"{}\"*", term))
        .collect::<Vec<_>>()
        .join(" ");

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

/// The words of a search, lowercase, split as the index splits text: at
/// anything but letters and digits, so "contractor's" gives "contractor".
/// Single letters, like the "s" left from that, are dropped when there are
/// longer words, since they would match nearly everything.
fn search_terms(query: &str) -> Vec<String> {
    let words: Vec<String> = query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect();
    let is_letter = |word: &String| word.chars().count() == 1;
    if words.iter().all(is_letter) {
        return words;
    }
    words.into_iter().filter(|word| !is_letter(word)).collect()
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

/// A shard as the links to it name it.
struct LinkedShard {
    /// With forward slashes.
    path: String,
    name: String,
    stem: String,
}

impl LinkedShard {
    fn new(path: &str) -> Self {
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
    fn is_target(&self, link_type: LinkType, target: &str) -> bool {
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

/// Every file that links to or mentions the shard at `file_path`, by name,
/// with the text around its first link to it.
pub fn get_backlinks(conn: &Connection, file_path: &str) -> Result<Vec<Backlink>, String> {
    let shard = LinkedShard::new(file_path);

    let mut stmt = conn
        .prepare(
            "SELECT source_file_id, link_type, target_path FROM links
             WHERE link_type IN ('internal', 'mention')",
        )
        .map_err(|e| format!("Failed to prepare links query: {}", e))?;
    let links = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| format!("Failed to query links: {}", e))?;
    let mut sources = HashSet::new();
    for link in links {
        let (source, link_type, target) =
            link.map_err(|e| format!("Failed to read link: {}", e))?;
        let link_type = if link_type == LinkType::Mention.as_str() {
            LinkType::Mention
        } else {
            LinkType::Internal
        };
        if shard.is_target(link_type, &target) {
            sources.insert(source);
        }
    }

    let mut stmt = conn
        .prepare(
            "SELECT f.path, f.name, s.content
             FROM files f
             LEFT JOIN fts_search s ON s.rowid = f.id
             WHERE f.id = ?1",
        )
        .map_err(|e| format!("Failed to prepare backlinks query: {}", e))?;
    let mut backlinks = sources
        .into_iter()
        .map(|source| {
            stmt.query_row(params![source], |row| {
                let path: String = row.get(0)?;
                let content: Option<String> = row.get(2)?;
                Ok(Backlink {
                    excerpt: link_excerpt(&shard, &path, content.as_deref().unwrap_or("")),
                    name: row.get(1)?,
                    path,
                })
            })
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to query backlinks: {}", e))?;
    backlinks.sort_by_cached_key(|backlink| backlink.name.to_lowercase());
    Ok(backlinks)
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
    fn splits_searches_as_the_index_splits_text() {
        assert_eq!(search_terms("Contractor's quote"), ["contractor", "quote"]);
        assert_eq!(search_terms("auto-save"), ["auto", "save"]);
        assert_eq!(search_terms("a b"), ["a", "b"]);
        assert!(search_terms(" ' \" ").is_empty());
    }

    #[test]
    fn searches_with_punctuation_and_query_words() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO files (id, path, name, last_modified, last_indexed, content_hash) VALUES (1, 'Quote.md', 'Quote.md', 0, 0, '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO fts_search (rowid, path, name, content) VALUES (1, 'Quote.md', 'Quote.md', ?1)",
            ["# Quote\n\nThe contractor's quote came in under budget."],
        )
        .unwrap();

        let results = search_files(&conn, "contractor's quote", 20).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(
            shown(&results[0].snippet),
            "The [contractor]'s [quote] came in under budget."
        );

        for query in [
            "\"quote",
            "quote-",
            "NOT quote",
            "name:quote",
            "(quote",
            "quote*",
        ] {
            assert!(search_files(&conn, query, 20).is_ok(), "{query}");
        }
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
            crate::db::indexer::index_file(&conn, &path).unwrap();
        }

        let plan = vault.join("Work/Plan.md").to_string_lossy().into_owned();
        let backlinks = get_backlinks(&conn, &plan).unwrap();
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
            crate::db::indexer::index_file(&conn, &vault.join(name)).unwrap();
        }

        let backlinks = get_backlinks(&conn, &roadmap.to_string_lossy()).unwrap();
        let names: Vec<_> = backlinks.iter().map(|b| b.name.as_str()).collect();
        assert_eq!(names, ["Bracketed.md", "Encoded.md"]);

        let _ = std::fs::remove_dir_all(&vault);
    }
}
