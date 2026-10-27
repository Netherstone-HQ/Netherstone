//! Reading shards, and their tables and charts.

use super::edits::{change, edit_shard, read_text};
use super::{Caller, ToolError, ToolResult, Vault};
use crate::markdown_text::{sections, tables as find_tables};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

// ── read ─────────────────────────────────────────────────────────────────────

pub const READ: &str = "Read shards. Gives the Markdown with the shard's words, \
tags, when it was created and changed, and how many shards link to it. For a long \
shard, ask for its outline first, then one section by its heading. Pass paths to \
read several shards at once.";

#[derive(Deserialize, JsonSchema)]
pub struct ReadParams {
    /// The shard, vault-relative, like Projects/Plan.md.
    #[serde(default)]
    path: Option<String>,
    /// Several shards to read at once, instead of path.
    #[serde(default)]
    paths: Option<Vec<String>>,
    /// Only the section under this heading, down to the next heading as high.
    #[serde(default)]
    section: Option<String>,
    /// Only the headings, to see how a long shard is laid out.
    #[serde(default)]
    outline: bool,
}

#[derive(Serialize)]
pub struct Heading {
    level: u8,
    title: String,
}

#[derive(Serialize)]
pub struct Shard {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    outline: Option<Vec<Heading>>,
    words: i64,
    tags: Vec<String>,
    created: String,
    modified: String,
    linked_from: usize,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum Read {
    One(Shard),
    Many { shards: Vec<Shard> },
}

/// The heading named `title` in `markdown`, ignoring case and `#`s.
pub(super) fn find_section(
    markdown: &str,
    title: &str,
) -> ToolResult<crate::markdown_text::Section> {
    let wanted = title.trim().trim_start_matches('#').trim();
    let found = sections(markdown);
    found
        .iter()
        .find(|section| section.title.eq_ignore_ascii_case(wanted))
        .cloned()
        .ok_or_else(|| {
            let headings: Vec<&str> = found.iter().map(|s| s.title.as_str()).collect();
            ToolError(format!(
                "There's no heading '{}'. Its headings are: {}",
                wanted,
                if headings.is_empty() { "none".to_string() } else { headings.join(", ") }
            ))
        })
}

fn read_one(vault: &Vault, relative: &str, section: Option<&str>, outline: bool) -> ToolResult<Shard> {
    let path = vault.shard(relative)?;
    let markdown = read_text(&path)?;
    let conn = vault.index()?;
    // The watcher keeps the index up to date; this covers a change it hasn't
    // caught yet.
    if crate::db::indexer::needs_indexing(&conn, &vault.root, &path)? {
        crate::db::indexer::index_file(&conn, &vault.root, &path)?;
    }
    let file = path.to_string_lossy();
    let metadata = crate::db::queries::get_file_metadata(&conn, &file)?;
    let linked_from = crate::db::queries::backlink_sources(&conn, &vault.root, &file)?.len();

    let content = match (outline, section) {
        (true, _) => None,
        (false, Some(title)) => Some(markdown[find_section(&markdown, title)?.range].to_string()),
        (false, None) => Some(markdown.clone()),
    };
    let outline = outline.then(|| {
        sections(&markdown)
            .into_iter()
            .map(|section| Heading {
                level: section.level,
                title: section.title,
            })
            .collect()
    });
    let date = |seconds| super::find::local_date(seconds);
    Ok(Shard {
        path: vault.relative(&path),
        content,
        outline,
        words: metadata.as_ref().map_or(0, |m| m.word_count),
        tags: metadata.as_ref().map(|m| m.tags.clone()).unwrap_or_default(),
        created: metadata.as_ref().map(|m| date(m.created_at)).unwrap_or_default(),
        modified: metadata.as_ref().map(|m| date(m.last_modified)).unwrap_or_default(),
        linked_from,
    })
}

pub fn read(vault: &Vault, _: &Caller, params: ReadParams) -> ToolResult<Read> {
    match (params.path, params.paths) {
        (Some(path), None) => {
            read_one(vault, &path, params.section.as_deref(), params.outline).map(Read::One)
        }
        (None, Some(paths)) => Ok(Read::Many {
            shards: paths
                .iter()
                .map(|path| read_one(vault, path, params.section.as_deref(), params.outline))
                .collect::<ToolResult<_>>()?,
        }),
        _ => Err(ToolError("Give path for one shard, or paths for several".to_string())),
    }
}

// ── tables ───────────────────────────────────────────────────────────────────

pub const TABLES: &str = "Read a shard's tables as rows, or draw a chart from one. \
read gives every table with its number (from 0 at the top), header row first. \
add_chart puts a bar or line chart under a table: x names the column along the \
bottom, y the columns with the numbers (up to three), by their headers.";

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum TablesAction {
    Read,
    AddChart,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum ChartKind {
    Bar,
    Line,
}

#[derive(Deserialize, JsonSchema)]
pub struct TablesParams {
    /// The shard, vault-relative.
    path: String,
    action: TablesAction,
    /// For add_chart: which table, from 0 at the top.
    #[serde(default)]
    table: Option<usize>,
    #[serde(default)]
    kind: Option<ChartKind>,
    /// The header of the column along the bottom.
    #[serde(default)]
    x: Option<String>,
    /// The headers of the columns with the numbers, up to three.
    #[serde(default)]
    y: Option<Vec<String>>,
    #[serde(default)]
    title: Option<String>,
    /// A short line on what you changed, shown in History.
    #[serde(default)]
    summary: Option<String>,
}

#[derive(Serialize)]
pub struct TableRows {
    table: usize,
    rows: Vec<Vec<String>>,
    has_chart: bool,
}

/// The columns a chart draws at most, as the app draws them.
const MAX_CHART_SERIES: usize = 3;

/// `text` as a name in a chart comment, which can't hold its separators or
/// end the comment early.
fn chart_name(text: &str) -> String {
    text.replace([';', ','], " ")
        .replace("--!>", " ")
        .replace("-->", " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Whether a chart comment comes right after `end` in `markdown`.
fn chart_after(markdown: &str, end: usize) -> bool {
    markdown[end..].trim_start().starts_with("<!-- netherstone chart:")
}

pub fn tables(vault: &Vault, caller: &Caller, params: TablesParams) -> ToolResult<Vec<TableRows>> {
    let path = vault.shard(&params.path)?;
    let markdown = read_text(&path)?;
    let found = find_tables(&markdown);
    let rows = |markdown: &str| -> Vec<TableRows> {
        find_tables(markdown)
            .into_iter()
            .enumerate()
            .map(|(table, found)| TableRows {
                table,
                has_chart: chart_after(markdown, found.range.end),
                rows: found.rows,
            })
            .collect()
    };
    match params.action {
        TablesAction::Read => Ok(rows(&markdown)),
        TablesAction::AddChart => {
            let index = params.table.unwrap_or(0);
            let Some(table) = found.get(index) else {
                return Err(ToolError(format!("The shard has {} tables; there's no table {}", found.len(), index)));
            };
            let header = table.rows.first().cloned().unwrap_or_default();
            let column = |name: &str| -> ToolResult<String> {
                header
                    .iter()
                    .find(|h| h.eq_ignore_ascii_case(name.trim()))
                    .cloned()
                    .ok_or_else(|| ToolError(format!("The table has no column '{}'. Its columns are: {}", name, header.join(", "))))
            };
            let mut parts = vec![match params.kind.unwrap_or(ChartKind::Bar) {
                ChartKind::Bar => "bar".to_string(),
                ChartKind::Line => "line".to_string(),
            }];
            if let Some(x) = &params.x {
                parts.push(format!("x {}", chart_name(&column(x)?)));
            }
            let y = params.y.unwrap_or_default();
            if y.len() > MAX_CHART_SERIES {
                return Err(ToolError(format!("A chart draws up to {} columns", MAX_CHART_SERIES)));
            }
            if !y.is_empty() {
                let y = y.iter().map(|name| column(name).map(|c| chart_name(&c))).collect::<ToolResult<Vec<_>>>()?;
                parts.push(format!("y {}", y.join(", ")));
            }
            if let Some(title) = params.title.as_deref().map(chart_name).filter(|t| !t.is_empty()) {
                parts.push(format!("title {}", title));
            }
            let comment = format!("<!-- netherstone chart: {} -->", parts.join("; "));

            change(vault, caller, params.summary.as_deref(), &[path.clone()], || {
                edit_shard(vault, &path, |markdown| {
                    // Found again under the lock, in the shard as it is now.
                    let table = find_tables(&markdown)
                        .into_iter()
                        .nth(index)
                        .ok_or_else(|| ToolError("The shard changed; read its tables again".to_string()))?;
                    if chart_after(&markdown, table.range.end) {
                        return Err(ToolError("That table already has a chart".to_string()));
                    }
                    let (before, after) = markdown.split_at(table.range.end);
                    let before = before.trim_end_matches('\n');
                    Ok(format!("{}\n\n{}\n\n{}", before, comment, after.trim_start_matches('\n')))
                })?;
                Ok(((), Vec::new()))
            })?;
            Ok(rows(&read_text(&path)?))
        }
    }
}
