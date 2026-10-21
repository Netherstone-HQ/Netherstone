use crate::markdown_text::{markdown_options, tags_in};
use pulldown_cmark::{Event, Parser, Tag, TagEnd};

/// Metadata extracted from a markdown file.
#[derive(Debug, Default)]
pub struct MarkdownMetadata {
    pub links: Vec<Link>,
    pub tags: Vec<String>,
    /// The titles of the charts drawn from tables, empty for an untitled one.
    pub charts: Vec<String>,
    pub word_count: usize,
    pub line_count: usize,
    pub character_count: usize,
}

#[derive(Debug)]
pub struct Link {
    pub target: String,
    pub text: Option<String>,
    pub link_type: LinkType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkType {
    Mention,
    Internal,
    External,
    Email,
    Phone,
    Anchor,
    Other,
}

impl LinkType {
    /// The name the `links` table stores.
    pub fn as_str(self) -> &'static str {
        match self {
            LinkType::Mention => "mention",
            LinkType::Internal => "internal",
            LinkType::External => "external",
            LinkType::Email => "email",
            LinkType::Phone => "phone",
            LinkType::Anchor => "anchor",
            LinkType::Other => "other",
        }
    }
}

/// What kind of link `target` is, by its scheme.
pub fn classify_link_target(target: &str) -> LinkType {
    let trimmed = target.trim();

    if trimmed.starts_with("mention:") {
        LinkType::Mention
    } else if trimmed.starts_with('#') {
        LinkType::Anchor
    } else if trimmed.starts_with("mailto:") {
        LinkType::Email
    } else if trimmed.starts_with("tel:") {
        LinkType::Phone
    } else if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("ftp://")
        || trimmed.starts_with("file://")
        || trimmed.starts_with("data:")
        || trimmed.starts_with("blob:")
        || trimmed.starts_with("asset:")
    {
        LinkType::External
    } else if trimmed.is_empty() {
        LinkType::Other
    } else {
        LinkType::Internal
    }
}

/// The title of the chart a `<!-- netherstone chart: … -->` comment draws
/// (see `src/lib/chart.ts`), or None when `html` isn't one.
pub fn chart_title(html: &str) -> Option<String> {
    let settings = html
        .trim()
        .strip_prefix("<!--")?
        .strip_suffix("-->")?
        .trim()
        .strip_prefix("netherstone chart:")?;
    Some(
        settings
            .split(';')
            .find_map(|part| part.trim().strip_prefix("title "))
            .map(|title| title.trim().to_string())
            .unwrap_or_default(),
    )
}

/// A chart and the table right above it, which it's drawn from.
#[derive(Debug, PartialEq)]
pub struct ChartTable {
    /// Which chart in the shard, from 0 at the top, counting every chart.
    pub index: usize,
    /// The chart's comment, as written.
    pub comment: String,
    /// The table's first row, which the chart names columns by.
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

/// The charts in `content` drawn from a table, each with that table's text
/// cell by cell, as the editor reads it. A chart with no table right above
/// it draws nothing and is left out.
pub fn chart_tables(content: &str) -> Vec<ChartTable> {
    let mut charts = Vec::new();
    let mut chart_count = 0;
    let mut depth = 0usize;
    // The rows of the table at the top being read, then of the last block
    // if it was a table.
    let mut table: Option<Vec<Vec<String>>> = None;
    let mut in_table = false;
    let mut html: Option<String> = None;

    for event in Parser::new_ext(content, markdown_options()) {
        match event {
            Event::Start(tag) => {
                match tag {
                    Tag::Table(_) if depth == 0 => {
                        table = Some(Vec::new());
                        in_table = true;
                    }
                    Tag::HtmlBlock if depth == 0 => html = Some(String::new()),
                    Tag::TableHead | Tag::TableRow if in_table => {
                        if let Some(rows) = table.as_mut() {
                            rows.push(Vec::new());
                        }
                    }
                    Tag::TableCell if in_table => {
                        if let Some(row) = table.as_mut().and_then(|rows| rows.last_mut()) {
                            row.push(String::new());
                        }
                    }
                    _ if depth == 0 => table = None,
                    _ => {}
                }
                depth += 1;
            }
            Event::End(TagEnd::Table) if depth == 1 => {
                depth = 0;
                in_table = false;
            }
            Event::End(TagEnd::HtmlBlock) if depth == 1 => {
                depth = 0;
                let text = html.take().unwrap_or_default();
                let above = table.take();
                if chart_title(&text).is_none() {
                    continue;
                }
                if let Some(mut rows) = above.filter(|rows| !rows.is_empty()) {
                    let columns = rows.remove(0);
                    charts.push(ChartTable {
                        index: chart_count,
                        comment: text.trim().to_string(),
                        columns,
                        rows,
                    });
                }
                chart_count += 1;
            }
            Event::End(_) => depth = depth.saturating_sub(1),
            Event::Html(text) => {
                if let Some(block) = html.as_mut() {
                    block.push_str(&text);
                }
            }
            Event::Text(text) | Event::Code(text) if in_table => {
                if let Some(cell) = table
                    .as_mut()
                    .and_then(|rows| rows.last_mut())
                    .and_then(|row| row.last_mut())
                {
                    cell.push_str(&text);
                }
            }
            _ if depth == 0 => table = None,
            _ => {}
        }
    }

    for chart in &mut charts {
        for cell in chart
            .columns
            .iter_mut()
            .chain(chart.rows.iter_mut().flatten())
        {
            *cell = cell.trim().to_string();
        }
    }
    charts
}

/// Parse markdown content and extract metadata.
///
/// Extracts:
/// - Links (`[markdown](links)`, mention links like `[label](mention:target)`, and external/email/phone/anchor links)
/// - Tags (hashtags like `#tag`)
/// - Word count
/// - Line count
/// - Character count
pub fn parse_markdown(content: &str) -> MarkdownMetadata {
    let mut metadata = MarkdownMetadata::default();
    let parser = Parser::new_ext(content, markdown_options());

    let mut current_link: Option<(String, String)> = None;
    let mut word_count = 0;
    let line_count = if content.is_empty() {
        0
    } else {
        content.lines().count()
    };
    let character_count = content.chars().count();

    for event in parser {
        match event {
            // ── Links ────────────────────────────────────────────────────────
            Event::Start(Tag::Link { dest_url, .. }) => {
                current_link = Some((dest_url.to_string(), String::new()));
            }
            Event::End(TagEnd::Link) => {
                if let Some((target, text)) = current_link.take() {
                    metadata.links.push(Link {
                        link_type: classify_link_target(&target),
                        target,
                        text: if text.is_empty() { None } else { Some(text) },
                    });
                }
            }

            // ── Text Content ─────────────────────────────────────────────────
            Event::Text(text) => {
                // Add to current link text if we're inside one
                if let Some((_, ref mut link_text)) = current_link {
                    link_text.push_str(&text);
                }

                metadata
                    .tags
                    .extend(tags_in(&text).map(|(_, tag)| tag.to_string()));

                // Count words
                word_count += text.split_whitespace().count();
            }

            Event::Html(text) => {
                // A chart's comment is settings, not words.
                if let Some(title) = chart_title(&text) {
                    metadata.charts.push(title);
                } else {
                    word_count += text.split_whitespace().count();
                }
            }

            Event::Code(text) => {
                word_count += text.split_whitespace().count();
            }

            _ => {}
        }
    }

    metadata.word_count = word_count;
    metadata.line_count = line_count;
    metadata.character_count = character_count;
    metadata
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_chart_titles_without_counting_their_words() {
        let meta = parse_markdown(
            "One two\n\n<!-- netherstone chart: bar; x a; y b; title Weekly km -->\n\n<!-- netherstone chart: line -->\n",
        );
        assert_eq!(meta.charts, ["Weekly km", ""]);
        assert_eq!(meta.word_count, 2);
    }

    #[test]
    fn reads_the_table_above_each_chart() {
        let charts = chart_tables(
            "<!-- netherstone chart: line -->\n\n\
             <!-- netherstone: widths 50% -->\n\
             | Week | **km** |\n| - | - |\n| 1 | `5` |\n| 2 | 7 |\n\n\
             <!-- netherstone chart: bar; x Week; y km; title Runs -->\n\n\
             | a | b |\n| - | - |\n| 1 | 2 |\n\nText\n\n\
             <!-- netherstone chart: bar -->\n",
        );
        assert_eq!(
            charts,
            [ChartTable {
                index: 1,
                comment: "<!-- netherstone chart: bar; x Week; y km; title Runs -->".into(),
                columns: vec!["Week".into(), "km".into()],
                rows: vec![vec!["1".into(), "5".into()], vec!["2".into(), "7".into()]],
            }]
        );
    }

    #[test]
    fn test_parse_links() {
        let content = "[Internal Link](mention:Internal%20Link.md-1)";
        let meta = parse_markdown(content);

        assert_eq!(meta.links.len(), 1);
        assert!(matches!(meta.links[0].link_type, LinkType::Mention));
        assert_eq!(meta.links[0].target, "mention:Internal%20Link.md-1");
    }

    #[test]
    fn test_classify_special_link_schemes() {
        let content = "[Mail](mailto:test@example.com) and [Call](tel:123)";
        let meta = parse_markdown(content);

        assert_eq!(meta.links.len(), 2);
        assert!(matches!(meta.links[0].link_type, LinkType::Email));
        assert!(matches!(meta.links[1].link_type, LinkType::Phone));
    }

    #[test]
    fn test_parse_tags() {
        let content = "This is a note with #tag1 and #tag2.";
        let meta = parse_markdown(content);

        assert_eq!(meta.tags.len(), 2);
        assert!(meta.tags.contains(&"tag1".to_string()));
        assert!(meta.tags.contains(&"tag2".to_string()));
    }

    #[test]
    fn test_word_count() {
        let content = "This is a test with exactly seven words.";
        let meta = parse_markdown(content);

        assert_eq!(meta.word_count, 8);
    }

    #[test]
    fn test_line_and_character_count() {
        let content = "Line one\nLine two";
        let meta = parse_markdown(content);

        assert_eq!(meta.line_count, 2);
        assert_eq!(meta.character_count, content.chars().count());
    }

    #[test]
    fn test_empty_content_line_and_character_count() {
        let meta = parse_markdown("");

        assert_eq!(meta.line_count, 0);
        assert_eq!(meta.character_count, 0);
    }
}
