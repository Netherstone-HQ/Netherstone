//! Shard Markdown as people read it, for showing text outside the editor:
//! plain-text blocks, the tags in them, word matches and highlighted excerpts.

use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use serde::Serialize;
use std::ops::Range;

/// The parser options for every reader of shard Markdown, matching the
/// editor's GitHub-flavored syntax: tables, task lists and strikethrough.
pub fn markdown_options() -> Options {
    Options::ENABLE_TABLES | Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH
}

/// The tags in a run of text, as the byte offset of each `#` and the tag: a
/// whitespace-separated word that starts with `#`, without trailing
/// punctuation.
pub fn tags_in(text: &str) -> impl Iterator<Item = (usize, &str)> {
    text.split_whitespace().filter_map(move |word| {
        let tag = word
            .strip_prefix('#')?
            .trim_end_matches(|c: char| c.is_ascii_punctuation());
        let offset = word.as_ptr() as usize - text.as_ptr() as usize;
        (!tag.is_empty()).then_some((offset, tag))
    })
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
}

/// Gathers the text of the block being read.
#[derive(Default)]
struct Blocks {
    done: Vec<TextBlock>,
    text: String,
    tags: Vec<(usize, String)>,
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

    fn finish(&mut self, kind: BlockKind) {
        let leading = self.text.len() - self.text.trim_start().len();
        let text = self.text.trim().replace(['\r', '\n'], " ");
        if !text.is_empty() {
            let tags = self.tags.drain(..).map(|(at, tag)| (at - leading, tag));
            self.done.push(TextBlock {
                kind,
                text,
                tags: tags.collect(),
            });
        }
        self.text.clear();
        self.tags.clear();
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
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
}
