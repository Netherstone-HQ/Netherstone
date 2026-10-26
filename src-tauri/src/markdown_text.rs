//! Shard Markdown as people read it, for showing text outside the editor:
//! plain-text blocks, the tags and links in them, word matches and highlighted
//! excerpts.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::{Deserialize, Serialize};
use std::ops::Range;

/// The parser options for every reader of shard Markdown, matching the
/// editor's GitHub-flavored syntax: tables, task lists and strikethrough.
pub fn markdown_options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH
}

/// The tags in a run of text, as the byte offset of each `#` and the tag: a
/// whitespace-separated word that starts with `#`, without trailing
/// punctuation, with at least one letter (so `#3` is a number, not a tag).
pub fn tags_in(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.split_whitespace().filter_map(move |word| {
        let tag = word
            .strip_prefix('#')?
            .trim_end_matches(|c: char| c.is_ascii_punctuation());
        let offset = word.as_ptr() as usize - text.as_ptr() as usize;
        has_letter(tag).then_some((offset, tag))
    })
}

/// Whether `tag` has a letter, as every tag must.
pub fn has_letter(tag: &str) -> bool {
    tag.chars().any(char::is_alphabetic)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum BlockKind {
    Heading { level: u8 },
    Paragraph,
    ListItem,
    Task { done: bool },
    CodeBlock,
    TableCell,
}

/// One block of a shard as plain text: no syntax, line breaks as spaces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TextBlock {
    pub kind: BlockKind,
    pub text: String,
    /// Each tag with the byte offset of its `#` in `text`.
    pub tags: Vec<(usize, String)>,
    /// Each link's text in `text`, with where the link goes.
    pub links: Vec<(Range<usize>, String)>,
}

/// Gathers the text of the block being read.
#[derive(Default)]
struct Blocks {
    done: Vec<TextBlock>,
    text: String,
    tags: Vec<(usize, String)>,
    links: Vec<(Range<usize>, String)>,
    /// Where the open link's text starts, and where it goes.
    link: Option<(usize, String)>,
}

impl Blocks {
    fn push(&mut self, text: &str, has_tags: bool) {
        if has_tags {
            let base = self.text.len();
            let found = tags_in(text).map(|(at, tag)| (base + at, tag.to_string()));
            self.tags.extend(found);
        }
        self.text.push_str(text);
    }

    fn start_link(&mut self, destination: &str) {
        self.link = Some((self.text.len(), destination.to_string()));
    }

    fn end_link(&mut self) {
        if let Some((start, destination)) = self.link.take() {
            self.links.push((start..self.text.len(), destination));
        }
    }

    fn finish(&mut self, kind: BlockKind) {
        let leading = self.text.len() - self.text.trim_start().len();
        let text = self.text.trim().replace(['\r', '\n'], " ");
        if !text.is_empty() {
            let tags = self.tags.drain(..).map(|(at, tag)| (at - leading, tag));
            let in_text = |at: usize| at.saturating_sub(leading).min(text.len());
            let links = self
                .links
                .drain(..)
                .map(|(range, to)| (in_text(range.start)..in_text(range.end), to))
                .filter(|(range, _)| !range.is_empty());
            self.done.push(TextBlock {
                kind,
                links: links.collect(),
                tags: tags.collect(),
                text,
            });
        }
        self.text.clear();
        self.tags.clear();
        self.links.clear();
    }
}

/// The readable blocks of `markdown` in order: headings, paragraphs, list
/// items, tasks, code blocks and table cells. Link targets, emphasis marks,
/// inline HTML and escapes are left out; link and image text stay.
pub fn text_blocks(markdown: &str) -> Vec<TextBlock> {
    let mut blocks = Blocks::default();
    let mut kind = BlockKind::Paragraph;
    // One entry per open list item: Some(done) once it shows a task box.
    let mut items: Vec<Option<bool>> = Vec::new();
    let in_item = |items: &[Option<bool>], kind: BlockKind| match (kind, items.last()) {
        (BlockKind::Paragraph, Some(Some(done))) => BlockKind::Task { done: *done },
        (BlockKind::Paragraph, Some(None)) => BlockKind::ListItem,
        _ => kind,
    };

    for event in Parser::new_ext(markdown, markdown_options()) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                kind = BlockKind::Heading { level: level as u8 }
            }
            Event::Start(Tag::Paragraph) => kind = BlockKind::Paragraph,
            Event::Start(Tag::CodeBlock(_)) => kind = BlockKind::CodeBlock,
            Event::Start(Tag::TableCell) => kind = BlockKind::TableCell,
            Event::Start(Tag::Item) => {
                items.push(None);
                kind = BlockKind::Paragraph;
            }
            // An item's own text ends where a list nested in it starts.
            Event::Start(Tag::List(_)) if !items.is_empty() => {
                blocks.finish(in_item(&items, BlockKind::Paragraph));
            }
            Event::TaskListMarker(done) => {
                if let Some(item) = items.last_mut() {
                    *item = Some(done);
                }
            }
            Event::Start(Tag::Link { dest_url, .. }) => blocks.start_link(&dest_url),
            Event::End(TagEnd::Link) => blocks.end_link(),
            Event::Text(text) => blocks.push(&text, true),
            Event::Code(code) => blocks.push(&code, false),
            Event::SoftBreak | Event::HardBreak => blocks.push(" ", false),
            Event::End(
                TagEnd::Heading(_) | TagEnd::Paragraph | TagEnd::CodeBlock | TagEnd::TableCell,
            ) => {
                blocks.finish(in_item(&items, kind));
                kind = BlockKind::Paragraph;
            }
            Event::End(TagEnd::Item) => {
                blocks.finish(in_item(&items, BlockKind::Paragraph));
                items.pop();
            }
            _ => {}
        }
    }
    blocks.done
}

/// The words in `text` that start with any of `terms` (lowercase), as byte
/// ranges. Words are runs of letters and digits, as the search index splits
/// them.
pub fn word_matches(text: &str, terms: &[String]) -> Vec<Range<usize>> {
    let mut matches = Vec::new();
    let mut word_start = None;
    for (index, c) in text.char_indices().chain([(text.len(), ' ')]) {
        match (c.is_alphanumeric(), word_start) {
            (true, None) => word_start = Some(index),
            (false, Some(start)) => {
                let word = text[start..index].to_lowercase();
                if terms.iter().any(|term| word.starts_with(term.as_str())) {
                    matches.push(start..index);
                }
                word_start = None;
            }
            _ => {}
        }
    }
    matches
}

/// A stretch of text, highlighted or not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TextPart {
    pub text: String,
    pub highlight: bool,
}

fn push_part(parts: &mut Vec<TextPart>, text: &str, highlight: bool) {
    if text.is_empty() {
        return;
    }
    match parts.last_mut() {
        Some(last) if last.highlight == highlight => last.text.push_str(text),
        _ => parts.push(TextPart {
            text: text.to_string(),
            highlight,
        }),
    }
}

/// The part of `text` around its first highlight: at most `before`
/// characters ahead of it and `after` past it, cut at whole words with "…",
/// split so each highlight inside can be marked. `highlights` are sorted,
/// non-overlapping byte ranges in `text`.
pub fn excerpt(
    text: &str,
    highlights: &[Range<usize>],
    before: usize,
    after: usize,
) -> Vec<TextPart> {
    let anchor = highlights.first().cloned().unwrap_or(0..0);

    let mut start = 0;
    if let Some((cut, dropped)) = text[..anchor.start].char_indices().rev().nth(before) {
        let kept = cut + dropped.len_utf8();
        start = text[kept..anchor.start]
            .find(char::is_whitespace)
            .map_or(kept, |space| kept + space);
    }
    let mut end = text.len();
    if let Some((cut, _)) = text[anchor.end..].char_indices().nth(after) {
        let limit = anchor.end + cut;
        end = text[anchor.end..limit]
            .rfind(char::is_whitespace)
            .map_or(limit, |space| anchor.end + space);
    }

    let mut parts = Vec::new();
    if start > 0 {
        push_part(&mut parts, "…", false);
    }
    let mut at = start;
    for range in highlights {
        let (from, to) = (range.start.max(start), range.end.min(end));
        if from >= to {
            continue;
        }
        let gap = &text[at..from];
        push_part(
            &mut parts,
            if at == start { gap.trim_start() } else { gap },
            false,
        );
        push_part(&mut parts, &text[from..to], true);
        at = to;
    }
    let rest = &text[at..end];
    push_part(
        &mut parts,
        if at == start {
            rest.trim()
        } else {
            rest.trim_end()
        },
        false,
    );
    if end < text.len() {
        push_part(&mut parts, "…", false);
    }
    parts
}

/// A heading in a shard and the part of the shard it starts, as byte ranges
/// of the Markdown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub level: u8,
    /// The heading's text, without its `#`s or emphasis marks.
    pub title: String,
    /// The heading's own line.
    pub heading: Range<usize>,
    /// From the heading to the next heading of the same level or higher, or
    /// the end of the shard.
    pub range: Range<usize>,
}

/// The sections of `markdown`, one per heading, in order.
pub fn sections(markdown: &str) -> Vec<Section> {
    let mut found: Vec<Section> = Vec::new();
    let mut open: Option<(u8, usize, String)> = None;
    for (event, range) in Parser::new_ext(markdown, markdown_options()).into_offset_iter() {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                open = Some((level as u8, range.start, String::new()))
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, _, title)) = open.as_mut() {
                    title.push_str(&text);
                }
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some((level, start, title)) = open.take() {
                    found.push(Section {
                        level,
                        title: title.trim().to_string(),
                        heading: start..range.end,
                        range: start..markdown.len(),
                    });
                }
            }
            _ => {}
        }
    }
    for index in 0..found.len() {
        let level = found[index].level;
        if let Some(next) = found[index + 1..].iter().find(|next| next.level <= level) {
            found[index].range.end = next.heading.start;
        }
    }
    found
}

/// A table in a shard: where it is in the Markdown, and its cells as text,
/// header row first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Table {
    pub range: Range<usize>,
    pub rows: Vec<Vec<String>>,
}

/// The tables of `markdown`, in order.
pub fn tables(markdown: &str) -> Vec<Table> {
    let mut found = Vec::new();
    let mut open: Option<Table> = None;
    for (event, range) in Parser::new_ext(markdown, markdown_options()).into_offset_iter() {
        match event {
            Event::Start(Tag::Table(_)) => {
                open = Some(Table {
                    range,
                    rows: Vec::new(),
                })
            }
            Event::Start(Tag::TableHead | Tag::TableRow) => {
                if let Some(table) = open.as_mut() {
                    table.rows.push(Vec::new());
                }
            }
            Event::Start(Tag::TableCell) => {
                if let Some(row) = open.as_mut().and_then(|table| table.rows.last_mut()) {
                    row.push(String::new());
                }
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some(cell) = open
                    .as_mut()
                    .and_then(|table| table.rows.last_mut())
                    .and_then(|row| row.last_mut())
                {
                    cell.push_str(&text);
                }
            }
            Event::End(TagEnd::Table) => {
                if let Some(mut table) = open.take() {
                    for cell in table.rows.iter_mut().flatten() {
                        *cell = cell.trim().to_string();
                    }
                    found.push(table);
                }
            }
            _ => {}
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(markdown: &str) -> Vec<(BlockKind, String)> {
        text_blocks(markdown)
            .into_iter()
            .map(|block| (block.kind, block.text))
            .collect()
    }

    fn plain(parts: &[TextPart]) -> String {
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
    fn reads_blocks_without_syntax() {
        let markdown = "# Plans\n\n\
            Call **Sam** about [the trip](mention:Trip.md) <u>soon</u>, see <https://x.y>.\n\n\
            - [ ] Book a ~~train~~ bus\n- [x] Pack\n- Snacks\n  - Nuts\n\n\
            > A `quote`\n\n\
            | Day | Plan |\n| --- | --- |\n| Mon | Rest |\n\n\
            ```\nlet x = 1;\n```";

        assert_eq!(
            texts(markdown),
            [
                (BlockKind::Heading { level: 1 }, "Plans".into()),
                (
                    BlockKind::Paragraph,
                    "Call Sam about the trip soon, see https://x.y.".into()
                ),
                (BlockKind::Task { done: false }, "Book a train bus".into()),
                (BlockKind::Task { done: true }, "Pack".into()),
                (BlockKind::ListItem, "Snacks".into()),
                (BlockKind::ListItem, "Nuts".into()),
                (BlockKind::Paragraph, "A quote".into()),
                (BlockKind::TableCell, "Day".into()),
                (BlockKind::TableCell, "Plan".into()),
                (BlockKind::TableCell, "Mon".into()),
                (BlockKind::TableCell, "Rest".into()),
                (BlockKind::CodeBlock, "let x = 1;".into()),
            ]
        );
    }

    #[test]
    fn finds_tags_as_the_indexer_does() {
        let blocks = text_blocks("Plans for **#ideas**, not `#code` or issue#3.\n\nAlso #todo.");
        assert_eq!(blocks[0].tags, [(10, "ideas".to_string())]);
        assert_eq!(&blocks[0].text[10..16], "#ideas");
        assert_eq!(blocks[1].tags, [(5, "todo".to_string())]);
    }

    #[test]
    fn tags_need_a_letter() {
        let tags: Vec<_> = tags_in("Step #3 of #2026, #q3 and #été, # alone.")
            .map(|(_, tag)| tag)
            .collect();
        assert_eq!(tags, ["q3", "été"]);
    }

    #[test]
    fn finds_links_and_where_they_go() {
        let blocks = text_blocks("  Ask [Sam](mention:Sam.md) about **[the plan](./Plan.md)**.");
        let links: Vec<_> = blocks[0]
            .links
            .iter()
            .map(|(range, to)| (&blocks[0].text[range.clone()], to.as_str()))
            .collect();
        assert_eq!(
            links,
            [("Sam", "mention:Sam.md"), ("the plan", "./Plan.md")]
        );
    }

    #[test]
    fn matches_words_by_prefix_ignoring_case() {
        let text = "Autosave runs; auto-save too. Cars";
        let matches = word_matches(text, &["auto".into(), "car".into()]);
        let words: Vec<_> = matches.iter().map(|r| &text[r.clone()]).collect();
        assert_eq!(words, ["Autosave", "auto", "Cars"]);
    }

    #[test]
    fn keeps_short_text_whole_and_marks_highlights() {
        let text = "A short line with #ideas in it.";
        assert_eq!(
            plain(&excerpt(text, &[18..24], 60, 200)),
            "A short line with [#ideas] in it."
        );
    }

    #[test]
    fn cuts_long_text_to_whole_words_around_the_first_highlight() {
        let text = format!("{}#ideas{}", "café ".repeat(40), " more".repeat(60));
        let start = text.find('#').unwrap();
        let parts = excerpt(&text, &[start..start + 6], 60, 200);
        let shown = plain(&parts);

        assert!(shown.starts_with("…café "), "{shown}");
        assert!(shown.ends_with(" more…"), "{shown}");
        assert!(shown.contains("café [#ideas] more"));
        assert!(shown.chars().count() <= 60 + 8 + 200 + 2);
    }

    #[test]
    fn excerpts_from_the_start_without_highlights() {
        assert_eq!(plain(&excerpt("Just text", &[], 60, 200)), "Just text");
    }

    #[test]
    fn sections_run_to_the_next_heading_as_high() {
        let markdown = "Intro\n\n# Plan\n\nText\n\n## Steps\n\nOne\n\n# **Done**\n\nEnd\n";
        let found = sections(markdown);
        let shown: Vec<_> = found
            .iter()
            .map(|s| (s.level, s.title.as_str(), &markdown[s.range.clone()]))
            .collect();
        assert_eq!(
            shown,
            [
                (1, "Plan", "# Plan\n\nText\n\n## Steps\n\nOne\n\n"),
                (2, "Steps", "## Steps\n\nOne\n\n"),
                (1, "Done", "# **Done**\n\nEnd\n"),
            ]
        );
    }

    #[test]
    fn tables_give_their_cells_and_place() {
        let markdown = "Runs\n\n| Week | km |\n| --- | --- |\n| 1 | `5` |\n\nAfter\n";
        let found = tables(markdown);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].rows, [vec!["Week", "km"], vec!["1", "5"]]);
        assert!(markdown[found[0].range.clone()].starts_with("| Week"));
        assert!(markdown[found[0].range.end..].contains("After"));
    }
}
