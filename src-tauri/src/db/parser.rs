use pulldown_cmark::{Event, Parser, Tag, TagEnd};

/// Metadata extracted from a markdown file.
#[derive(Debug, Default)]
pub struct MarkdownMetadata {
    pub links: Vec<Link>,
    pub tags: Vec<String>,
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

/// Parse markdown content and extract metadata.
///
/// Extracts:
/// - Links (`[markdown](links)`, mention links like `[label](mention:target)`, and external/email/phone/anchor links)
/// - Tags (hashtags like `#tag`)
/// - Word count
/// - Line count
/// - Character count
fn classify_link_target(target: &str) -> LinkType {
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

pub fn parse_markdown(content: &str) -> MarkdownMetadata {
    let mut metadata = MarkdownMetadata::default();
    let parser = Parser::new(content);

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

                // Extract tags (hashtags)
                for word in text.split_whitespace() {
                    if let Some(tag) = word.strip_prefix('#') {
                        // Remove trailing punctuation
                        let clean_tag = tag.trim_end_matches(|c: char| c.is_ascii_punctuation());
                        if !clean_tag.is_empty() {
                            metadata.tags.push(clean_tag.to_string());
                        }
                    }
                }

                // Count words
                word_count += text.split_whitespace().count();
            }

            Event::Code(text) | Event::Html(text) => {
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
