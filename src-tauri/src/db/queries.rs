use super::attachments::vault_key;
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

/// Search the files of the vault at `vault_path` using FTS5 full-text search.
///
/// Returns matching files with text snippets, ordered by relevance.
pub fn search_files(
    conn: &Connection,
    vault_path: &Path,
    query: &str,
    limit: usize,
) -> rusqlite::Result<Vec<SearchResult>> {
    eprintln!("[Netherstone] Searching for: '{}'", query);
    if search_terms(query).is_empty() {
        return Ok(Vec::new());
    }
    let filter = FileFilter {
        query,
        ..FileFilter::default()
    };
    let results: Vec<SearchResult> = find_files(conn, vault_path, &filter, 0, limit)?
        .into_iter()
        .map(|file| SearchResult {
            path: file.path,
            name: file.name,
            snippet: file.snippet,
            rank: file.rank,
        })
        .collect();
    eprintln!("[Netherstone] Found {} search results", results.len());
    Ok(results)
}

/// Which files of a vault to find. Everything left out matches any file.
#[derive(Debug, Default)]
pub struct FileFilter<'a> {
    /// Words the text must have, matched as prefixes. Empty finds files by
    /// the rest of the filter, newest first.
    pub query: &'a str,
    /// A folder the files must be in, at any depth.
    pub folder: Option<&'a Path>,
    pub tag: Option<&'a str>,
    /// Unix seconds the file was last changed at or after, and before.
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct FoundFile {
    pub path: String,
    pub name: String,
    /// The text around the words searched for, which are highlighted, or
    /// around the tag, or the start of the text.
    pub snippet: Vec<TextPart>,
    /// Lower is better; 0 when nothing was searched for.
    pub rank: f64,
    pub last_modified: i64,
    pub word_count: i64,
}

/// The files of the vault at `vault_path` that `filter` finds: by relevance
/// when it has words, otherwise newest first. `offset` and `limit` page
/// through them.
pub fn find_files(
    conn: &Connection,
    vault_path: &Path,
    filter: &FileFilter,
    offset: usize,
    limit: usize,
) -> rusqlite::Result<Vec<FoundFile>> {
    let terms = search_terms(filter.query);
    let mut conditions = vec!["f.vault_path = ?".to_string()];
    let mut values: Vec<rusqlite::types::Value> = vec![vault_key(vault_path).into()];

    if !terms.is_empty() {
        // Each term quoted, so nothing typed is read as query syntax, and
        // matched as a prefix: "auto save" becomes "auto"* "save"*.
        let fts_query = terms
            .iter()
            .map(|term| format!("\"{}\"*", term))
            .collect::<Vec<_>>()
            .join(" ");
        conditions.push("fts_search MATCH ?".to_string());
        values.push(fts_query.into());
    }
    if let Some(folder) = filter.folder {
        let inside = format!("{}{}", folder.to_string_lossy(), std::path::MAIN_SEPARATOR);
        conditions.push("substr(f.path, 1, length(?)) = ?".to_string());
        values.push(inside.clone().into());
        values.push(inside.into());
    }
    if let Some(tag) = filter.tag {
        conditions.push(
            "f.id IN (SELECT file_id FROM tags WHERE tag = ? COLLATE NOCASE)".to_string(),
        );
        values.push(tag.trim_start_matches('#').to_string().into());
    }
    if let Some(after) = filter.modified_after {
        conditions.push("f.last_modified >= ?".to_string());
        values.push(after.into());
    }
    if let Some(before) = filter.modified_before {
        conditions.push("f.last_modified < ?".to_string());
        values.push(before.into());
    }
    values.push((limit as i64).into());
    values.push((offset as i64).into());

    let (rank, order) = if terms.is_empty() {
        ("0.0", "f.last_modified DESC, f.path")
    } else {
        ("rank", "rank")
    };
    let sql = format!(
        "SELECT f.path, f.name, fts_search.content, {rank}, f.last_modified, f.word_count
         FROM files f
         INNER JOIN fts_search ON fts_search.rowid = f.id
         WHERE {}
         ORDER BY {order}
         LIMIT ? OFFSET ?",
        conditions.join(" AND ")
    );

    let highlighted: Vec<String> = match (&terms, filter.tag) {
        (terms, Some(tag)) if terms.is_empty() => vec![tag.trim_start_matches('#').to_lowercase()],
        _ => terms.clone(),
    };
    let mut stmt = conn.prepare(&sql)?;
    let found = stmt
        .query_map(rusqlite::params_from_iter(values), |row| {
            let content: String = row.get(2)?;
            Ok(FoundFile {
                path: row.get(0)?,
                name: row.get(1)?,
                snippet: search_snippet(&content, &highlighted),
                rank: row.get(3)?,
                last_modified: row.get(4)?,
                word_count: row.get(5)?,
            })
        })?
        .collect();
    found
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
            params![vault_key(vault_path), shard.path, without_md, shard.stem, shard.name],
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
    backlinks_from(conn, file_path, backlink_sources(conn, vault_path, file_path)?)
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
            "INSERT INTO files (id, vault_path, path, name, last_modified, last_indexed, content_hash) VALUES (1, '/v', 'Quote.md', 'Quote.md', 0, 0, '')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO fts_search (rowid, path, name, content) VALUES (1, 'Quote.md', 'Quote.md', ?1)",
            ["# Quote\n\nThe contractor's quote came in under budget."],
        )
        .unwrap();

        let results = search_files(&conn, Path::new("/v"), "contractor's quote", 20).unwrap();
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
            assert!(search_files(&conn, Path::new("/v"), query, 20).is_ok(), "{query}");
        }
    }

    #[test]
    fn a_vault_inside_another_keeps_its_own_rows() {
        let dir = crate::sync::state::tests::temp_dir("index-nested-vault");
        let (outer, inner) = (dir.join("Outer"), dir.join("Outer/Inner"));
        std::fs::create_dir_all(&inner).unwrap();
        crate::sync::state::load_or_create_record(&dir.join("sync"), &inner).unwrap();
        std::fs::write(outer.join("Plan.md"), "Outer plan").unwrap();
        std::fs::write(inner.join("Plan.md"), "Inner plan").unwrap();
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        let paths = |vault: &Path| -> Vec<String> {
            search_files(&conn, vault, "plan", 20)
                .unwrap()
                .into_iter()
                .map(|r| r.path)
                .collect()
        };

        crate::db::indexer::index_vault(&conn, &outer).unwrap();
        crate::db::indexer::index_file(&conn, &outer, &inner.join("Plan.md")).unwrap();
        crate::db::indexer::index_vault(&conn, &inner).unwrap();
        assert_eq!(paths(&outer), [outer.join("Plan.md").to_string_lossy()]);
        assert_eq!(paths(&inner), [inner.join("Plan.md").to_string_lossy()]);

        // Indexing the outer vault again leaves the inner one's rows alone.
        crate::db::indexer::index_vault(&conn, &outer).unwrap();
        assert_eq!(paths(&inner), [inner.join("Plan.md").to_string_lossy()]);
    }

    #[test]
    fn keeps_each_vaults_rows_apart() {
        let root =
            std::env::temp_dir().join(format!("netherstone-two-vaults-{}", std::process::id()));
        let (work, home, empty) = (root.join("Work"), root.join("Home"), root.join("Empty"));
        for vault in [&work, &home, &empty] {
            std::fs::create_dir_all(vault).unwrap();
        }
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        for (vault, name) in [(&work, "Plan.md"), (&work, "Gone.md"), (&home, "Trip.md")] {
            let path = vault.join(name);
            std::fs::write(&path, "Shared plan #ideas").unwrap();
            crate::db::indexer::index_file(&conn, vault, &path).unwrap();
        }
        let names = |vault: &Path| -> Vec<String> {
            search_files(&conn, vault, "plan", 20)
                .unwrap()
                .into_iter()
                .map(|r| r.name)
                .collect()
        };

        let plan = work.join("Plan.md").to_string_lossy().into_owned();
        crate::db::indexer::prune_deleted_files(&conn, &work, &[plan]).unwrap();
        crate::db::indexer::prune_deleted_files(&conn, &empty, &[]).unwrap();

        assert_eq!(names(&work), ["Plan.md"]);
        assert_eq!(names(&home), ["Trip.md"]);
        assert!(names(&empty).is_empty());
        let tagged = get_tagged_files(&conn, &home).unwrap();
        assert_eq!(tagged.len(), 1);
        assert_eq!(tagged[0].name, "Trip.md");
        // The pruned file's search text went with it.
        let searchable: i64 = conn
            .query_row("SELECT COUNT(*) FROM fts_search", [], |row| row.get(0))
            .unwrap();
        assert_eq!(searchable, 2);
        let trip = home.join("Trip.md");
        assert!(!crate::db::indexer::needs_indexing(&conn, &home, &trip).unwrap());
        std::fs::remove_dir_all(&root).unwrap();
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
