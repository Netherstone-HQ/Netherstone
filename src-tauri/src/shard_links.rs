//! Links between shards are written relative to the linking file
//! (`[Plan](../Projects/Plan.md)`). When a shard or a folder of shards is
//! renamed or moved, this module rewrites the links so they keep pointing at
//! the same shards: the moved shards' own links, and the links to them in
//! every other shard.

use pulldown_cmark::{Event, LinkType as MdLinkType, Parser, Tag};
use std::ops::Range;
use std::path::Path;

use crate::db::indexer::{resolve_internal_target, resolve_mention_target};
use crate::db::parser::{LinkType, classify_link_target};
use crate::db::queries::LinkedShard;
use crate::markdown_text::markdown_options;

/// A shard that was at `old` and is now at `new`, as OS paths.
pub struct MovedShard {
    pub old: String,
    pub new: String,
}

fn normalize(path: &str) -> String {
    path.replace('\\', "/")
}

fn is_drive(segment: &str) -> bool {
    let bytes = segment.as_bytes();
    bytes.len() == 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_absolute_like(path: &str) -> bool {
    let normalized = normalize(path);
    normalized.starts_with('/')
        || normalized
            .split('/')
            .next()
            .is_some_and(|first| is_drive(first) && normalized.contains('/'))
}

fn parent_segments(file: &str) -> Vec<String> {
    let normalized = normalize(file);
    let mut segments: Vec<String> = normalized
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    segments.pop();
    segments
}

/// The path of `target` relative to the folder of `from_file`, with `..`
/// for each folder left. Paths on different drives share no folder, so the
/// target stays absolute.
pub fn relative_path(from_file: &str, target: &str) -> String {
    let from = parent_segments(from_file);
    let normalized_target = normalize(target);
    let to: Vec<&str> = normalized_target
        .split('/')
        .filter(|s| !s.is_empty())
        .collect();

    let mut common = 0;
    while common < from.len() && common < to.len() {
        let (a, b) = (from[common].as_str(), to[common]);
        let same = if is_drive(a) && is_drive(b) {
            a.eq_ignore_ascii_case(b)
        } else {
            a == b
        };
        if !same {
            break;
        }
        common += 1;
    }

    if common == 0
        && (from.first().is_some_and(|s| is_drive(s)) || to.first().is_some_and(|s| is_drive(s)))
    {
        return normalized_target;
    }

    let mut parts: Vec<String> = vec!["..".to_string(); from.len() - common];
    parts.extend(to[common..].iter().map(|s| s.to_string()));
    parts.join("/")
}

/// Percent-encodes a path segment by segment, the way the editor writes
/// shard links.
pub fn encode_path(path: &str) -> String {
    normalize(path)
        .split('/')
        .map(|segment| {
            if segment == "." || segment == ".." {
                segment.to_string()
            } else {
                urlencoding::encode(segment).into_owned()
            }
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn same_path(a: &str, b: &str) -> bool {
    normalize(a).eq_ignore_ascii_case(&normalize(b))
}

/// The byte ranges of the destination text of each inline link in
/// `markdown`, as written (code and images are not links).
fn link_destinations(markdown: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();

    for (event, range) in Parser::new_ext(markdown, markdown_options()).into_offset_iter() {
        let Event::Start(Tag::Link {
            link_type: MdLinkType::Inline,
            ..
        }) = event
        else {
            continue;
        };
        if let Some(destination) = destination_in(&markdown[range.clone()]) {
            ranges.push(range.start + destination.start..range.start + destination.end);
        }
    }

    ranges
}

/// Where the destination sits in the source of one inline link,
/// `[text](destination "title")` or `[text](<destination> "title")`.
fn destination_in(link: &str) -> Option<Range<usize>> {
    let open = link.rfind("](")? + 2;
    let rest = &link[open..];
    let skipped = rest.len() - rest.trim_start().len();
    let start = open + skipped;
    let body = &link[start..];

    if let Some(inner) = body.strip_prefix('<') {
        let end = inner.find('>')?;
        return Some(start + 1..start + 1 + end);
    }

    let mut depth = 0usize;
    for (index, ch) in body.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' if depth > 0 => depth -= 1,
            ')' | ' ' | '\t' | '\n' => return Some(start..start + index),
            _ => {}
        }
    }
    None
}

/// Where a link written in the file that was at `file_old` and is now at
/// `file_new` should point, or None when it needs no change: a link to a
/// shard follows the shard, an old `mention:` link to a moved shard becomes
/// a relative link, and anything else (web links, attachments, headings) is
/// left as written.
fn rewrite_destination(
    destination: &str,
    file_old: &str,
    file_new: &str,
    moved: &[MovedShard],
) -> Option<String> {
    let trimmed = destination.trim();
    if trimmed.is_empty() {
        return None;
    }

    match classify_link_target(trimmed) {
        LinkType::Mention => {
            let resolved = resolve_mention_target(trimmed);
            let shard = moved
                .iter()
                .find(|m| LinkedShard::new(&m.old).is_target(LinkType::Mention, &resolved))?;
            Some(encode_path(&relative_path(file_new, &shard.new)))
        }
        LinkType::Internal => {
            let suffix_at = trimmed.find(['#', '?']).unwrap_or(trimmed.len());
            let (path_part, suffix) = trimmed.split_at(suffix_at);
            let decoded = urlencoding::decode(path_part)
                .map(|value| value.into_owned())
                .unwrap_or_else(|_| path_part.to_string());
            if is_absolute_like(&decoded) || !decoded.to_ascii_lowercase().ends_with(".md") {
                return None;
            }

            let target_old = resolve_internal_target(Path::new(file_old), path_part);
            let target_new = moved
                .iter()
                .find(|m| same_path(&m.old, &target_old))
                .map(|m| normalize(&m.new))
                .unwrap_or(target_old);
            let rewritten = format!(
                "{}{}",
                encode_path(&relative_path(file_new, &target_new)),
                suffix
            );
            (rewritten != trimmed).then_some(rewritten)
        }
        _ => None,
    }
}

/// `markdown`, the content of the file that was at `file_old` and is now at
/// `file_new` (the same path when the file itself didn't move), with its
/// links to shards pointing where the shards are after `moved`; None when
/// nothing changes.
pub fn rewrite_moved_links(
    markdown: &str,
    file_old: &str,
    file_new: &str,
    moved: &[MovedShard],
) -> Option<String> {
    let mut output = String::with_capacity(markdown.len());
    let mut cursor = 0;
    let mut changed = false;

    for range in link_destinations(markdown) {
        let destination = &markdown[range.clone()];
        if let Some(rewritten) = rewrite_destination(destination, file_old, file_new, moved) {
            output.push_str(&markdown[cursor..range.start]);
            output.push_str(&rewritten);
            cursor = range.end;
            changed = true;
        }
    }

    if !changed {
        return None;
    }
    output.push_str(&markdown[cursor..]);
    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn moved(pairs: &[(&str, &str)]) -> Vec<MovedShard> {
        pairs
            .iter()
            .map(|(old, new)| MovedShard {
                old: old.to_string(),
                new: new.to_string(),
            })
            .collect()
    }

    #[test]
    fn relative_paths_walk_folders() {
        assert_eq!(
            relative_path("C:/V/Daily/Today.md", "C:/V/Daily/Me.md"),
            "Me.md"
        );
        assert_eq!(
            relative_path("C:\\V\\Daily\\Today.md", "C:/V/Projects/Plan.md"),
            "../Projects/Plan.md"
        );
        assert_eq!(
            relative_path("/home/me/V/Today.md", "/home/me/V/A/B/Plan.md"),
            "A/B/Plan.md"
        );
        assert_eq!(relative_path("c:/V/Today.md", "C:/V/Plan.md"), "Plan.md");
        assert_eq!(
            relative_path("C:/V/Today.md", "D:/Other/Plan.md"),
            "D:/Other/Plan.md"
        );
    }

    #[test]
    fn encodes_segments_like_the_editor() {
        assert_eq!(
            encode_path("../A b/It's (draft)!.md"),
            "../A%20b/It%27s%20%28draft%29%21.md"
        );
    }

    #[test]
    fn a_moved_shard_keeps_its_links_to_shards_that_stayed() {
        let content = "See [the plan](../Projects/Plan.md) and [Me](Me.md), [heading](Me.md#top), ![pic](_attachments/a.png) and [web](https://x.y/a.md).\n";
        let out = rewrite_moved_links(
            content,
            "/V/Daily/Today.md",
            "/V/Archive/2026/Today.md",
            &moved(&[("/V/Daily/Today.md", "/V/Archive/2026/Today.md")]),
        )
        .unwrap();
        assert_eq!(
            out,
            "See [the plan](../../Projects/Plan.md) and [Me](../../Daily/Me.md), [heading](../../Daily/Me.md#top), ![pic](_attachments/a.png) and [web](https://x.y/a.md).\n"
        );
    }

    #[test]
    fn shards_moved_together_keep_their_links_to_each_other() {
        let content = "[Notes](2026/Notes.md) and [Out](../Out.md)\n";
        let out = rewrite_moved_links(
            content,
            "/V/Work/Plan.md",
            "/V/Archive/Work/Plan.md",
            &moved(&[
                ("/V/Work/Plan.md", "/V/Archive/Work/Plan.md"),
                ("/V/Work/2026/Notes.md", "/V/Archive/Work/2026/Notes.md"),
            ]),
        )
        .unwrap();
        assert_eq!(out, "[Notes](2026/Notes.md) and [Out](../../Out.md)\n");
    }

    #[test]
    fn other_shards_follow_a_renamed_shard() {
        let content = "Old [plan](Work/Plan.md), legacy [Plan](mention:Plan) and [path](mention:%2FV%2FWork%2FPlan.md-3), not [other](Work/Other.md).\n";
        let out = rewrite_moved_links(
            content,
            "/V/Today.md",
            "/V/Today.md",
            &moved(&[("/V/Work/Plan.md", "/V/Work/Roadmap.md")]),
        )
        .unwrap();
        assert_eq!(
            out,
            "Old [plan](Work/Roadmap.md), legacy [Plan](Work/Roadmap.md) and [path](Work/Roadmap.md), not [other](Work/Other.md).\n"
        );
    }

    #[test]
    fn leaves_code_angle_brackets_and_unrelated_files_alone() {
        let content = "`[x](Plan.md)` and\n\n```\n[y](Plan.md)\n```\n\n[z](<Work/My Plan.md>) stays, [w](Plan.md) too.\n";
        let out = rewrite_moved_links(
            content,
            "/V/Today.md",
            "/V/Today.md",
            &moved(&[("/V/Work/My Plan.md", "/V/Done/My Plan.md")]),
        )
        .unwrap();
        assert_eq!(
            out,
            "`[x](Plan.md)` and\n\n```\n[y](Plan.md)\n```\n\n[z](<Done/My%20Plan.md>) stays, [w](Plan.md) too.\n"
        );
        assert!(
            rewrite_moved_links(
                "[w](Plan.md)\n",
                "/V/T.md",
                "/V/T.md",
                &moved(&[("/V/A.md", "/V/B.md")])
            )
            .is_none()
        );
    }
}
