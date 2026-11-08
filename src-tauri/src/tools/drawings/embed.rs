//! Showing a drawing in a shard: the image tag the app writes for it.

use crate::tools::ToolResult;
use crate::tools::read::find_section;
use std::path::Path;

/// Width of a drawing's picture in a shard, as the app embeds it.
const EMBED_WIDTH: &str = "480";

fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// The image tag the app writes for a drawing in a shard, without its
/// pictures yet: the app exports them when the shard is next opened.
pub(super) fn embed_tag(relative: &str) -> String {
    let name = Path::new(relative)
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    format!(
        "<img src=\"\" data-dark-src=\"\" alt=\"{}\" width=\"{}\" data-excalidraw=\"{}\" />",
        escape_attribute(&name),
        EMBED_WIDTH,
        escape_attribute(relative)
    )
}

/// `markdown` with the pictures of each drawing it shows left blank, as
/// embed writes them, to tell a shard's own changes from the app filling
/// those pictures in.
pub(in crate::tools) fn without_pictures(markdown: &str) -> String {
    let mut out = String::with_capacity(markdown.len());
    let mut rest = markdown;
    while let Some(start) = rest.find("<img") {
        let Some(len) = rest[start..].find('>') else {
            break;
        };
        let end = start + len + 1;
        out.push_str(&rest[..start]);
        let tag = &rest[start..end];
        if tag.contains(" data-excalidraw=\"") {
            out.push_str(&blank_attribute(
                &blank_attribute(tag, " src=\""),
                " data-dark-src=\"",
            ));
        } else {
            out.push_str(tag);
        }
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

/// `tag` with the value of the attribute that starts with `name` emptied.
fn blank_attribute(tag: &str, name: &str) -> String {
    let Some(at) = tag.find(name) else {
        return tag.to_string();
    };
    let value = at + name.len();
    match tag[value..].find('"') {
        Some(len) => format!("{}{}", &tag[..value], &tag[value + len..]),
        None => tag.to_string(),
    }
}

/// `markdown` with the drawing at `relative` shown under `heading`, or at
/// the end.
pub(in crate::tools) fn embedded(
    markdown: &str,
    relative: &str,
    heading: Option<&str>,
) -> ToolResult<String> {
    let at = match heading {
        Some(heading) => find_section(markdown, heading)?.range.end,
        None => markdown.len(),
    };
    let (before, after) = markdown.split_at(at);
    let before = before.trim_end_matches(['\n', '\r', ' ']);
    let gap = if before.is_empty() { "" } else { "\n\n" };
    let rest = after.trim_start_matches(['\n', '\r']);
    let tail = if rest.is_empty() {
        String::new()
    } else {
        format!("\n{}", rest)
    };
    Ok(format!(
        "{}{}{}\n{}",
        before,
        gap,
        embed_tag(relative),
        tail
    ))
}
