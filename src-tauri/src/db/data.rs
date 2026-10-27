//! What the Overview page shows: the words written each day, the @ links
//! that point to shards that don't exist, and the charts.
//!
//! Words come from the vault's local history, which every device and outside
//! edits add to. Days before the history began keep this device's own count,
//! from what was typed in the editor.

use super::attachments::vault_key;
use super::parser::{LinkType, chart_tables, parse_markdown};
use crate::sync::writing::WritingHistory;
use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Days of writing the Overview page is sent, enough for a whole year's calendar.
const LOG_DAYS: i64 = 400;

/// The first day the Overview page is sent writing for.
pub fn first_log_day(today: &str) -> String {
    chrono::NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .ok()
        .and_then(|date| date.checked_sub_days(chrono::Days::new(LOG_DAYS as u64 - 1)))
        .map(|date| date.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| today.to_string())
}

#[derive(Debug, Serialize, PartialEq)]
pub struct WritingEntry {
    /// The local date, as `YYYY-MM-DD`.
    pub day: String,
    pub path: String,
    pub name: String,
    /// Words added to the shard that day, never below zero.
    pub words: i64,
    /// False once the shard is deleted; its words still count.
    pub exists: bool,
    /// For a deleted shard: whether the local history still has it.
    pub has_history: bool,
}

#[derive(Debug, Serialize)]
pub struct WritingLog {
    pub shard_count: i64,
    pub word_count: i64,
    /// The first day with writing counted, as `YYYY-MM-DD`.
    pub started_on: String,
    /// Oldest first.
    pub entries: Vec<WritingEntry>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct BrokenLink {
    /// The link's text, as the chip shows it.
    pub text: String,
    /// The shard holding the link.
    pub path: String,
    pub name: String,
    /// Where it points, as the index stores it: a mention's shard name, or
    /// an internal link's path.
    pub target: String,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct ShardChart {
    /// The shard holding the chart.
    pub path: String,
    pub name: String,
    /// Which chart in the shard, from 0 at the top.
    pub index: usize,
    /// The chart's comment, which the page reads its settings from.
    pub comment: String,
    /// The table it's drawn from: its first row, then the others.
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// Every chart drawn from a table in the vault at `vault_path`, those in the
/// shards edited last first.
pub fn get_charts(conn: &Connection, vault_path: &Path) -> rusqlite::Result<Vec<ShardChart>> {
    let mut stmt = conn.prepare(
        "SELECT f.path, f.name, s.content FROM files f JOIN fts_search s ON s.rowid = f.id
         WHERE f.vault_path = ?1 AND EXISTS (SELECT 1 FROM charts c WHERE c.file_id = f.id)
         ORDER BY f.last_modified DESC, f.path",
    )?;
    let shards = stmt
        .query_map(params![vault_key(vault_path)], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    Ok(shards
        .into_iter()
        .flat_map(|(path, name, content)| {
            chart_tables(&content)
                .into_iter()
                .map(move |chart| ShardChart {
                    path: path.clone(),
                    name: name.clone(),
                    index: chart.index,
                    comment: chart.comment,
                    columns: chart.columns,
                    rows: chart.rows,
                })
        })
        .collect())
}

/// Today's date on this device, as `YYYY-MM-DD`.
pub fn local_today() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Notes that `file_path` was edited on `day`. The first save of the day keeps
/// the word count the shard started the day with, read by `previous_content`
/// only then; every save updates where it ended.
pub fn record_writing(
    conn: &Connection,
    day: &str,
    file_path: &str,
    content: &str,
    previous_content: impl FnOnce() -> Option<String>,
) -> rusqlite::Result<()> {
    let words = parse_markdown(content).word_count as i64;
    let updated = conn.execute(
        "UPDATE writing_log SET end_words = ?3 WHERE day = ?1 AND file_path = ?2",
        params![day, file_path, words],
    )?;
    if updated > 0 {
        return Ok(());
    }

    let start = previous_content()
        .map(|previous| parse_markdown(&previous).word_count as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO writing_log (day, file_path, start_words, end_words) VALUES (?1, ?2, ?3, ?4)",
        params![day, file_path, start, words],
    )?;
    Ok(())
}

/// Moves a shard's writing to its new path after a rename or move.
pub fn rename_writing_path(conn: &Connection, previous: &str, next: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE OR IGNORE writing_log SET file_path = ?2 WHERE file_path = ?1",
        params![previous, next],
    )?;
    Ok(())
}

/// Starts counting for `vault_path` on `day`, unless it already started.
pub fn start_writing_log(conn: &Connection, vault_path: &str, day: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO writing_log_start (vault_path, started_on) VALUES (?1, ?2)",
        params![vault_path, day],
    )?;
    Ok(())
}

fn path_key(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn file_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(path)
        .to_string()
}

/// The vault's totals and its last year of writing, for the Overview page:
/// from `history` where it has the day, from this device's log before. The
/// day the history began has both, so each shard keeps the larger count.
/// The index is read for the vault's shards only; the log is filtered by path.
pub fn get_writing_log(
    conn: &Connection,
    vault_path: &str,
    today: &str,
    history: Option<&WritingHistory>,
) -> rusqlite::Result<WritingLog> {
    start_writing_log(conn, vault_path, today)?;
    let logged_since: String = conn.query_row(
        "SELECT started_on FROM writing_log_start WHERE vault_path = ?1",
        params![vault_path],
        |row| row.get(0),
    )?;

    let vault = Path::new(vault_path);
    let indexed_vault = vault_key(vault);
    let (shard_count, word_count) = conn.query_row(
        "SELECT COUNT(*), COALESCE(SUM(word_count), 0) FROM files WHERE vault_path = ?1",
        params![indexed_vault],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;

    let mut existing = HashSet::new();
    {
        let mut stmt = conn.prepare("SELECT path FROM files WHERE vault_path = ?1")?;
        for path in stmt.query_map(params![indexed_vault], |row| row.get::<_, String>(0))? {
            existing.insert(path_key(&path?));
        }
    }

    let began_on = history.map(|history| history.began_on.as_str());
    // By day and path key: the path as written, and the words.
    let mut words: HashMap<(String, String), (String, i64)> = HashMap::new();
    let mut stmt = conn.prepare(
        "SELECT day, file_path, MAX(end_words - start_words, 0) FROM writing_log
         WHERE day >= ?1 AND day <= COALESCE(?2, day)",
    )?;
    let rows = stmt.query_map(params![first_log_day(today), began_on], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    for row in rows {
        let (day, path, count) = row?;
        if Path::new(&path).starts_with(vault) {
            words.insert((day, path_key(&path)), (path, count));
        }
    }
    if let Some(history) = history {
        for written in &history.days {
            let path = vault
                .join(written.path.split('/').collect::<PathBuf>())
                .to_string_lossy()
                .into_owned();
            let entry = words
                .entry((written.day.clone(), path_key(&path)))
                .or_insert((path, 0));
            entry.1 = entry.1.max(written.words);
        }
    }

    let vault_key = path_key(vault_path);
    let in_history = |key: &str| {
        history.is_some_and(|history| {
            key.strip_prefix(&vault_key)
                .map(|relative| relative.trim_start_matches('/'))
                .is_some_and(|relative| history.seen_paths.contains(relative))
        })
    };
    let mut entries: Vec<WritingEntry> = words
        .into_iter()
        .map(|((day, key), (path, words))| {
            let exists = existing.contains(&key);
            WritingEntry {
                has_history: !exists && in_history(&key),
                exists,
                name: file_name(&path),
                day,
                path,
                words,
            }
        })
        .collect();
    entries.sort_by(|a, b| (&a.day, &a.path).cmp(&(&b.day, &b.path)));

    let started_on = match began_on {
        Some(began_on) if began_on < logged_since.as_str() => began_on.to_string(),
        _ => logged_since,
    };
    Ok(WritingLog {
        shard_count,
        word_count,
        started_on,
        entries,
    })
}

/// Whether an internal link's target names a shard rather than a picture,
/// a file or a web page: it ends in `.md`.
fn is_shard_target(target: &str) -> bool {
    target.to_lowercase().ends_with(".md")
}

/// The @ links in the vault at `vault_path` that point to shards that don't
/// exist, in the order of the shards holding them.
pub fn get_broken_links(conn: &Connection, vault_path: &Path) -> rusqlite::Result<Vec<BrokenLink>> {
    find_broken_links(conn, vault_path, None, None)
}

/// [`get_broken_links`], only in the shard at `in_shard` when given, and
/// stopping once it has found `wanted` when given.
pub fn find_broken_links(
    conn: &Connection,
    vault_path: &Path,
    in_shard: Option<&Path>,
    wanted: Option<usize>,
) -> rusqlite::Result<Vec<BrokenLink>> {
    let vault = vault_key(vault_path);
    let mut paths = HashSet::new();
    let mut names = HashSet::new();
    let mut shard = None;
    {
        let mut stmt = conn.prepare("SELECT path FROM files WHERE vault_path = ?1")?;
        for path in stmt.query_map(params![vault], |row| row.get::<_, String>(0))? {
            let path = path?;
            let name = file_name(&path).to_lowercase();
            if let Some(stem) = name.strip_suffix(".md") {
                names.insert(stem.to_string());
            }
            names.insert(name);
            paths.insert(path_key(&path));
            if in_shard.is_some_and(|in_shard| Path::new(&path) == in_shard) {
                shard = Some(path);
            }
        }
    }
    if in_shard.is_some() && shard.is_none() {
        return Ok(Vec::new());
    }

    let mut stmt = conn.prepare(&format!(
        "SELECT f.path, f.name, l.link_type, l.target_path, l.link_text
         FROM links l JOIN files f ON f.id = l.source_file_id
         WHERE f.vault_path = ?1 AND l.link_type IN ('internal', 'mention'){}
         ORDER BY f.name COLLATE NOCASE, f.path, l.id",
        if shard.is_some() { " AND f.path = ?2" } else { "" }
    ))?;
    let row = |row: &rusqlite::Row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    };
    let rows = match &shard {
        Some(shard) => stmt.query_map(params![vault, shard], row)?,
        None => stmt.query_map(params![vault], row)?,
    };

    let mut broken = Vec::new();
    let mut seen = HashSet::new();
    for row in rows {
        if wanted.is_some_and(|wanted| broken.len() >= wanted) {
            break;
        }
        let (path, name, link_type, target, text) = row?;
        let exists = if link_type == LinkType::Mention.as_str() {
            target.is_empty()
                || paths.contains(&path_key(&target))
                || names.contains(&target.to_lowercase())
        } else {
            !is_shard_target(&target)
                || paths.contains(&path_key(&target))
                // A shard outside the vault, linked on purpose.
                || Path::new(&target).is_file()
        };
        if exists {
            continue;
        }
        let text = text.unwrap_or_else(|| {
            let name = file_name(&target);
            name.strip_suffix(".md").unwrap_or(&name).to_string()
        });
        // The same missing shard linked twice from one shard is one fix.
        if seen.insert((path.clone(), path_key(&target))) {
            broken.push(BrokenLink { text, path, name, target });
        }
    }
    Ok(broken)
}

#[cfg(test)]
fn logged_words(conn: &Connection, day: &str, file_path: &str) -> Option<(i64, i64)> {
    conn.query_row(
        "SELECT start_words, end_words FROM writing_log WHERE day = ?1 AND file_path = ?2",
        params![day, file_path],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::schema::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn keeps_the_first_count_of_the_day_and_the_last() {
        let conn = memory_db();
        let mut reads = 0;
        record_writing(&conn, "2026-10-19", "/v/a.md", "one two three", || {
            reads += 1;
            Some("one".into())
        })
        .unwrap();
        record_writing(
            &conn,
            "2026-10-19",
            "/v/a.md",
            "one two three four five",
            || {
                reads += 1;
                None
            },
        )
        .unwrap();

        assert_eq!(reads, 1);
        assert_eq!(logged_words(&conn, "2026-10-19", "/v/a.md"), Some((1, 5)));
    }

    #[test]
    fn counts_words_added_in_the_vault_only() {
        let conn = memory_db();
        record_writing(&conn, "2026-10-18", "/v/a.md", "a b c d", || None).unwrap();
        record_writing(&conn, "2026-10-19", "/v/a.md", "a", || {
            Some("a b c d".into())
        })
        .unwrap();
        record_writing(&conn, "2026-10-19", "/other/b.md", "x y", || None).unwrap();
        // Long ago: left out.
        record_writing(&conn, "2024-01-01", "/v/old.md", "x", || None).unwrap();

        let log = get_writing_log(&conn, "/v", "2026-10-19", None).unwrap();
        assert_eq!(log.started_on, "2026-10-19");
        let days: Vec<_> = log
            .entries
            .iter()
            .map(|e| (e.day.as_str(), e.name.as_str(), e.words, e.exists))
            .collect();
        assert_eq!(
            days,
            [
                ("2026-10-18", "a.md", 4, false),
                ("2026-10-19", "a.md", 0, false)
            ]
        );
    }

    #[test]
    fn counts_from_history_once_it_began() {
        use crate::sync::writing::{WritingHistory, WrittenDay};
        let conn = memory_db();
        record_writing(&conn, "2026-10-17", "/v/a.md", "a b c d", || None).unwrap();
        record_writing(&conn, "2026-10-18", "/v/a.md", "a b c d e", || {
            Some("a b c d".into())
        })
        .unwrap();
        // Counted by history, which has every device.
        record_writing(&conn, "2026-10-19", "/v/b.md", "x", || None).unwrap();

        let written = |day: &str, path: &str, words| WrittenDay {
            day: day.into(),
            path: path.into(),
            words,
        };
        let history = WritingHistory {
            began_on: "2026-10-18".into(),
            days: vec![
                written("2026-10-18", "a.md", 3),
                written("2026-10-19", "b.md", 5),
                written("2026-10-19", "Folder/c.md", 2),
            ],
            seen_paths: ["a.md", "b.md", "folder/c.md"].map(String::from).into(),
        };
        let log = get_writing_log(&conn, "/v", "2026-10-19", Some(&history)).unwrap();
        assert_eq!(log.started_on, "2026-10-18");
        let days: Vec<_> = log
            .entries
            .iter()
            .map(|e| (e.day.as_str(), e.name.as_str(), e.words, e.has_history))
            .collect();
        assert_eq!(
            days,
            [
                ("2026-10-17", "a.md", 4, true),
                // The day history began: the larger of the two counts.
                ("2026-10-18", "a.md", 3, true),
                ("2026-10-19", "c.md", 2, true),
                ("2026-10-19", "b.md", 5, true),
            ]
        );
    }

    #[test]
    fn moves_writing_with_a_renamed_shard() {
        let conn = memory_db();
        record_writing(&conn, "2026-10-19", "/v/a.md", "a b", || None).unwrap();
        rename_writing_path(&conn, "/v/a.md", "/v/b.md").unwrap();
        assert_eq!(logged_words(&conn, "2026-10-19", "/v/b.md"), Some((0, 2)));
    }

    #[test]
    fn lists_charts_with_their_tables() {
        let dir = std::env::temp_dir().join(format!("netherstone-charts-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("Runs.md"),
            "| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- netherstone chart: bar; x a; y b; title km -->\n",
        )
        .unwrap();
        std::fs::write(dir.join("Plain.md"), "<!-- netherstone: widths 100 -->\n").unwrap();

        let conn = memory_db();
        for name in ["Runs.md", "Plain.md"] {
            crate::db::indexer::index_file(&conn, &dir, &dir.join(name)).unwrap();
        }
        let charts = get_charts(&conn, &dir).unwrap();
        std::fs::remove_dir_all(&dir).unwrap();

        let shown: Vec<_> = charts
            .iter()
            .map(|c| (c.name.as_str(), c.index, c.columns.clone(), c.rows.clone()))
            .collect();
        assert_eq!(
            shown,
            [(
                "Runs.md",
                0,
                vec!["a".to_string(), "b".to_string()],
                vec![vec!["1".to_string(), "2".to_string()]]
            )]
        );
    }

    #[test]
    fn lists_links_to_missing_shards() {
        let dir = std::env::temp_dir().join(format!("netherstone-broken-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("Notes")).unwrap();
        std::fs::write(dir.join("Plan.md"), "Plan").unwrap();
        std::fs::write(
            dir.join("Notes/Ideas.md"),
            "[Plan](../Plan.md) [Gone](../Gone.md) [Gone](../Gone.md) \
             [Old](mention:Old) [Plan](mention:Plan) [pic](../pic.png) [web](https://a.b)",
        )
        .unwrap();

        let conn = memory_db();
        for name in ["Plan.md", "Notes/Ideas.md"] {
            crate::db::indexer::index_file(&conn, &dir, &dir.join(name)).unwrap();
        }
        let shown = |broken: Vec<BrokenLink>| -> Vec<(String, String)> {
            broken.into_iter().map(|b| (b.text, b.name)).collect()
        };
        let all = [("Gone".to_string(), "Ideas.md".to_string()), ("Old".to_string(), "Ideas.md".to_string())];
        assert_eq!(shown(get_broken_links(&conn, &dir).unwrap()), all);
        // A page stops once it has what it wants.
        assert_eq!(shown(find_broken_links(&conn, &dir, None, Some(1)).unwrap()), all[..1]);
        // In one shard.
        let ideas = dir.join("Notes").join("Ideas.md");
        assert_eq!(shown(find_broken_links(&conn, &dir, Some(&ideas), None).unwrap()), all);
        assert!(find_broken_links(&conn, &dir, Some(&dir.join("Plan.md")), None).unwrap().is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
