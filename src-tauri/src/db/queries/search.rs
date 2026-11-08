//! Finding files by their words: full-text search, its filters, and the
//! highlighted title and snippet each result shows.

use super::{EXCERPT_AFTER, EXCERPT_BEFORE};
use crate::db::attachments::vault_key;
use crate::db::words::Search;
use crate::markdown_text::{BlockKind, TextPart, excerpt, text_blocks};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;
use std::ops::Range;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct SearchResult {
    pub path: String,
    pub name: String,
    /// The name without its extension, with the words searched for
    /// highlighted.
    pub title: Vec<TextPart>,
    /// The text around the words searched for, which are highlighted.
    pub snippet: Vec<TextPart>,
    /// The heading the snippet is under, if any.
    pub section: Option<String>,
    pub rank: f64,
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
    let search = Search::new(conn, vault_path, query, false)?;
    if search.is_empty() {
        return Ok(Vec::new());
    }
    let filter = FileFilter {
        query,
        ..FileFilter::default()
    };
    let results: Vec<SearchResult> = find_files(conn, vault_path, &filter, 0, limit)?
        .into_iter()
        .map(|file| SearchResult {
            title: highlighted(file.name.strip_suffix(".md").unwrap_or(&file.name), &search),
            path: file.path,
            name: file.name,
            snippet: file.snippet,
            section: file.section,
            rank: file.rank,
        })
        .collect();
    eprintln!("[Netherstone] Found {} search results", results.len());
    Ok(results)
}

/// `text` with the words `search` matches highlighted.
fn highlighted(text: &str, search: &Search) -> Vec<TextPart> {
    let mut parts = Vec::new();
    let mut last = 0;
    for (range, _) in search.matches(text) {
        parts.push((&text[last..range.start], false));
        parts.push((&text[range.clone()], true));
        last = range.end;
    }
    parts.push((&text[last..], false));
    parts
        .into_iter()
        .filter(|(text, _)| !text.is_empty())
        .map(|(text, highlight)| TextPart {
            text: text.to_string(),
            highlight,
        })
        .collect()
}

/// Which files of a vault to find. Everything left out matches any file.
#[derive(Debug, Default)]
pub struct FileFilter<'a> {
    /// Words the text must have, matched as word starts or by their stems.
    /// Empty finds files by the rest of the filter, newest first.
    pub query: &'a str,
    /// Whether one of the words is enough, instead of all of them.
    pub any: bool,
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
    /// The heading the snippet is under, if any.
    pub section: Option<String>,
    /// Lower is better; 0 when nothing was searched for.
    pub rank: f64,
    pub last_modified: i64,
    pub word_count: i64,
}

/// The files of the vault at `vault_path` that `filter` finds: by relevance
/// when it has words, the ones with the words as typed first, otherwise
/// newest first. `offset` and `limit` page through them.
pub fn find_files(
    conn: &Connection,
    vault_path: &Path,
    filter: &FileFilter,
    offset: usize,
    limit: usize,
) -> rusqlite::Result<Vec<FoundFile>> {
    let search = Search::new(conn, vault_path, filter.query, filter.any)?;
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    let mut joins = String::new();
    let fts = search.fts();
    if let Some(fts) = &fts {
        joins.push_str(
            " INNER JOIN (SELECT rowid, rank FROM fts_search WHERE fts_search MATCH ?) m
               ON m.rowid = f.id",
        );
        values.push(fts.clone().into());
    }

    let mut conditions = vec!["f.vault_path = ?".to_string()];
    values.push(vault_key(vault_path).into());
    if let Some(folder) = filter.folder {
        let inside = format!("{}{}", folder.to_string_lossy(), std::path::MAIN_SEPARATOR);
        conditions.push("substr(f.path, 1, length(?)) = ?".to_string());
        values.push(inside.clone().into());
        values.push(inside.into());
    }
    if let Some(tag) = filter.tag {
        conditions
            .push("f.id IN (SELECT file_id FROM tags WHERE tag = ? COLLATE NOCASE)".to_string());
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

    let rank = if fts.is_some() { "m.rank" } else { "0.0" };
    let order = match (search.exact(), search.is_empty()) {
        (Some(exact), _) => {
            values.push(exact.into());
            "f.id IN (SELECT rowid FROM fts_search WHERE fts_search MATCH ?) DESC, score, \
             f.last_modified DESC, f.path"
        }
        (None, false) => "score, f.last_modified DESC, f.path",
        (None, true) => "f.last_modified DESC, f.path",
    };
    values.push((limit as i64).into());
    values.push((offset as i64).into());
    let sql = format!(
        "SELECT f.path, f.name, s.content, {rank} AS score, f.last_modified, f.word_count
         FROM files f
         INNER JOIN fts_search s ON s.rowid = f.id{joins}
         WHERE {}
         ORDER BY {order}
         LIMIT ? OFFSET ?",
        conditions.join(" AND ")
    );

    let tag = filter
        .tag
        .filter(|_| search.is_empty())
        .map(|tag| tag.trim_start_matches('#').to_lowercase());
    let highlight = match &tag {
        Some(tag) => Search::new(conn, vault_path, tag, false)?,
        None => search,
    };
    let mut stmt = conn.prepare(&sql)?;
    stmt.query_map(rusqlite::params_from_iter(values), |row| {
        let content: String = row.get(2)?;
        let (snippet, section) = search_snippet(&content, &highlight);
        Ok(FoundFile {
            path: row.get(0)?,
            name: row.get(1)?,
            snippet,
            section,
            rank: row.get(3)?,
            last_modified: row.get(4)?,
            word_count: row.get(5)?,
        })
    })?
    .collect()
}

/// The block matching the most search terms, around its first match, with
/// the heading it's under. With no match in the text (the name matched),
/// the start of the first non-heading block.
fn search_snippet(content: &str, search: &Search) -> (Vec<TextPart>, Option<String>) {
    let blocks = text_blocks(content);
    let mut heading = None;
    // The earliest of the blocks with the most terms, with its matches and
    // the heading it's under.
    let mut best = None;
    let mut best_found = 0;
    for block in &blocks {
        if matches!(block.kind, BlockKind::Heading { .. }) {
            heading = Some(block.text.as_str());
        }
        let matches = search.matches(&block.text);
        let found = matches
            .iter()
            .map(|(_, term)| *term)
            .collect::<HashSet<_>>()
            .len();
        if found > best_found {
            best_found = found;
            best = Some((block, matches, heading));
        }
    }

    match best {
        Some((block, matches, section)) => {
            let ranges: Vec<Range<usize>> = matches.into_iter().map(|(range, _)| range).collect();
            (
                excerpt(&block.text, &ranges, EXCERPT_BEFORE, EXCERPT_AFTER),
                section.map(str::to_string),
            )
        }
        None => (
            blocks
                .iter()
                .find(|block| !matches!(block.kind, BlockKind::Heading { .. }))
                .map(|block| excerpt(&block.text, &[], EXCERPT_BEFORE, EXCERPT_AFTER))
                .unwrap_or_default(),
            None,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::queries::get_tagged_files;
    use crate::db::queries::shown;

    #[test]
    fn snippets_show_the_block_with_the_most_search_terms() {
        let content =
            "# Trip\n\nPack the bags.\n\nBook the **train** for the trip.\n\nTrain snacks.";
        let (snippet, section) = search_snippet(content, &Search::unstemmed("train trip"));
        assert_eq!(shown(&snippet), "Book the [train] for the [trip].");
        assert_eq!(section.as_deref(), Some("Trip"));
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
            assert!(
                search_files(&conn, Path::new("/v"), query, 20).is_ok(),
                "{query}"
            );
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

        std::fs::remove_file(work.join("Gone.md")).unwrap();
        crate::db::indexer::index_vault(&conn, &work).unwrap();
        crate::db::indexer::index_vault(&conn, &empty).unwrap();

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
        let trip = home.join("Trip.md").to_string_lossy().into_owned();
        let indexed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM files WHERE path = ?1",
                [&trip],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexed, 1);
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_other_word_forms_and_scripts_without_spaces() {
        let vault = crate::sync::state::tests::temp_dir("queries-word-forms");
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        for (name, text) in [
            (
                "Garden.md",
                "# Spring\n\nThe gardeners were planting flowers along the paths while \
                 we talked about the season ahead of us.\n",
            ),
            (
                "Plants.md",
                "# Notes\n\nWe plant flowers in the garden every spring, and the paths \
                 stay open all season for everyone.\n",
            ),
            ("Tokyo.md", "# 旅行\n\n今日は東京へ行きます。\n"),
        ] {
            let path = vault.join(name);
            std::fs::write(&path, text).unwrap();
            crate::db::indexer::index_file(&conn, &vault, &path).unwrap();
        }
        let find = |query: &str, any: bool| {
            let filter = FileFilter {
                query,
                any,
                ..FileFilter::default()
            };
            find_files(&conn, &vault, &filter, 0, 20).unwrap()
        };
        let names = |found: &[FoundFile]| -> Vec<String> {
            found.iter().map(|file| file.name.clone()).collect()
        };

        // The shard with the word as typed comes first.
        let found = find("planting", false);
        assert_eq!(names(&found), ["Garden.md", "Plants.md"]);
        assert_eq!(
            shown(&found[1].snippet),
            "We [plant] flowers in the garden every spring, and the paths stay open all season for everyone."
        );
        assert_eq!(found[1].section.as_deref(), Some("Notes"));

        assert_eq!(names(&find("talked everyone", false)), Vec::<String>::new());
        assert_eq!(
            names(&find("talked everyone", true)).len(),
            2,
            "any of the words"
        );

        let found = find("東京", false);
        assert_eq!(names(&found), ["Tokyo.md"]);
        assert_eq!(shown(&found[0].snippet), "今日は[東京]へ行きます。");
        assert_eq!(names(&find("東京へ行", false)), ["Tokyo.md"]);
        assert_eq!(names(&find("京", false)), ["Tokyo.md"], "inside a run");
        assert_eq!(names(&find("す", false)), ["Tokyo.md"], "at its end");
        assert_eq!(names(&find("大阪", false)), Vec::<String>::new());

        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn snippets_fall_back_to_the_first_paragraph() {
        let content = "# Trip\n\nPack the bags.";
        assert_eq!(
            shown(&search_snippet(content, &Search::unstemmed("zebra")).0),
            "Pack the bags."
        );
    }
}
