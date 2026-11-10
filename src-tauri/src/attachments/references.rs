//! What shards link to: attachment links, drawing embeds, and files outside
//! the attachment folder.

use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use urlencoding::decode;

use super::policy::{
    ATTACHMENTS_DIR_NAME, AttachmentReferenceKind, extension_for_path, normalize_attachment_path,
    path_from_asset_path, reference_kind_for_path,
};
use super::store::register_untracked_attachment;
use crate::db::attachments::{
    is_tracked, now_unix_seconds, referenced_attachments, refresh_attachment_counts, shard_key,
    vault_key,
};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct ParsedAttachmentReference {
    pub(crate) asset_path: String,
    pub(crate) reference_kind: AttachmentReferenceKind,
}

/// Makes sure `asset_path` has a database row, creating it from the file on
/// disk if needed. Returns false when there is no row because the file is
/// missing.
fn ensure_attachment_record_for_existing_asset(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
) -> Result<bool, String> {
    if is_tracked(conn, vault_path, asset_path)? {
        return Ok(true);
    }

    let absolute_path = path_from_asset_path(vault_path, asset_path)?;
    let size_bytes = match std::fs::metadata(&absolute_path) {
        Ok(metadata) if metadata.is_file() => metadata.len(),
        _ => return Ok(false),
    };

    // Read a piece at a time: the file can be a long video.
    register_untracked_attachment(conn, vault_path, asset_path, size_bytes)?;
    Ok(true)
}

/// HTML attributes that point at a file. `data-dark-src` is a drawing's dark
/// export, shown instead of `src` in dark themes.
const SOURCE_ATTRIBUTES: [&str; 4] = ["netherstoneStoredSource", "src", "data-dark-src", "href"];

fn html_reference_kind(html: &str) -> AttachmentReferenceKind {
    let lower = html.trim_start().to_ascii_lowercase();

    if lower.starts_with("<audio") {
        AttachmentReferenceKind::Audio
    } else if lower.starts_with("<video") {
        AttachmentReferenceKind::Video
    } else if lower.starts_with("<img") {
        AttachmentReferenceKind::Image
    } else {
        AttachmentReferenceKind::File
    }
}

pub(crate) fn extract_html_attr_value(html: &str, attr_name: &str) -> Option<String> {
    let lower_html = html.to_ascii_lowercase();
    let lower_attr = attr_name.to_ascii_lowercase();
    let mut search_start = 0;

    while let Some(relative_index) = lower_html[search_start..].find(&lower_attr) {
        let attr_start = search_start + relative_index;
        let before = html[..attr_start].chars().next_back();
        let after_index = attr_start + attr_name.len();
        let after = html[after_index..].chars().next();

        let boundary_before = before.is_none_or(|c| c.is_whitespace() || c == '<');
        let boundary_after = after.is_none_or(|c| c.is_whitespace() || c == '=');

        if !boundary_before || !boundary_after {
            search_start = after_index;
            continue;
        }

        let mut rest = html[after_index..].trim_start();
        if !rest.starts_with('=') {
            search_start = after_index;
            continue;
        }

        rest = rest[1..].trim_start();
        let quote = rest.chars().next()?;

        if quote == '"' || quote == '\'' {
            let value_start = quote.len_utf8();
            let value_rest = &rest[value_start..];
            let value_end = value_rest.find(quote).unwrap_or(value_rest.len());
            return Some(value_rest[..value_end].to_string());
        }

        let value_end = rest
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest.len());
        return Some(rest[..value_end].to_string());
    }

    None
}

fn push_html_attachment_reference(references: &mut Vec<ParsedAttachmentReference>, html: &str) {
    let default_kind = html_reference_kind(html);
    let mut seen_paths = HashSet::new();

    for attr_name in SOURCE_ATTRIBUTES {
        let Some(value) = extract_html_attr_value(html, attr_name) else {
            continue;
        };
        let Some(asset_path) = normalize_attachment_path(&value) else {
            continue;
        };

        if !seen_paths.insert(asset_path.clone()) {
            continue;
        }

        let reference_kind = reference_kind_for_path(&asset_path, default_kind);

        references.push(ParsedAttachmentReference {
            asset_path,
            reference_kind,
        });
    }
}

pub(crate) fn parse_attachment_references(content: &str) -> Vec<ParsedAttachmentReference> {
    let parser = Parser::new(content);
    let mut references = Vec::new();

    for event in parser {
        match event {
            Event::Start(Tag::Image { dest_url, .. }) => {
                if let Some(asset_path) = normalize_attachment_path(&dest_url) {
                    let reference_kind =
                        reference_kind_for_path(&asset_path, AttachmentReferenceKind::Image);
                    references.push(ParsedAttachmentReference {
                        asset_path,
                        reference_kind,
                    });
                }
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                if let Some(asset_path) = normalize_attachment_path(&dest_url) {
                    let reference_kind =
                        reference_kind_for_path(&asset_path, AttachmentReferenceKind::File);
                    references.push(ParsedAttachmentReference {
                        asset_path,
                        reference_kind,
                    });
                }
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                push_html_attachment_reference(&mut references, &html);
            }
            Event::End(TagEnd::Image) | Event::End(TagEnd::Link) => {}
            _ => {}
        }
    }

    references
}

/// A drawing export a shard embeds: its image and, when it has one, the
/// same drawing exported dark.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DrawingExport {
    pub asset_path: String,
    pub dark_asset_path: Option<String>,
}

/// The drawing exports embedded in `content`: images that name their
/// drawing (`data-excalidraw`) or carry a dark export (`data-dark-src`).
pub(crate) fn parse_drawing_exports(content: &str) -> Vec<DrawingExport> {
    let mut exports = Vec::new();

    for event in Parser::new(content) {
        let (Event::Html(html) | Event::InlineHtml(html)) = event else {
            continue;
        };
        if html_reference_kind(&html) != AttachmentReferenceKind::Image {
            continue;
        }
        let dark_asset_path = extract_html_attr_value(&html, "data-dark-src")
            .and_then(|value| normalize_attachment_path(&value));
        if dark_asset_path.is_none() && extract_html_attr_value(&html, "data-excalidraw").is_none()
        {
            continue;
        }
        let Some(asset_path) = extract_html_attr_value(&html, "src")
            .and_then(|value| normalize_attachment_path(&value))
        else {
            continue;
        };
        exports.push(DrawingExport {
            asset_path,
            dark_asset_path,
        });
    }

    exports
}

/// The drawings `content` shows, as each image tag names its drawing
/// (`data-excalidraw`, vault-relative), with the attribute's escapes undone.
pub(crate) fn parse_drawing_embeds(content: &str) -> Vec<String> {
    let mut drawings = Vec::new();

    for event in Parser::new(content) {
        let (Event::Html(html) | Event::InlineHtml(html)) = event else {
            continue;
        };
        for tag in html.split('<') {
            let Some(value) = extract_html_attr_value(tag, "data-excalidraw") else {
                continue;
            };
            let drawing = unescape_attribute(&value);
            if !drawing.is_empty() && !drawings.contains(&drawing) {
                drawings.push(drawing);
            }
        }
    }

    drawings
}

/// Undoes the escapes an attribute value is written with.
fn unescape_attribute(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

/// Points the attachment references of the shard at `file_path`, in the
/// vault at `vault_path`, at what `content` links to.
pub fn sync_references_for_saved_markdown(
    conn: &Connection,
    vault_path: &Path,
    file_path: &str,
    content: &str,
) -> Result<(), String> {
    let references = parse_attachment_references(content);
    let now = now_unix_seconds();

    let vault = vault_key(vault_path);
    let key = shard_key(vault_path, file_path);
    let previous = referenced_attachments(conn, &vault, &key)?;

    conn.execute(
        "DELETE FROM attachment_references WHERE vault_path = ?1 AND file_path = ?2",
        params![vault, key],
    )
    .map_err(|e| format!("Failed to clear attachment references: {}", e))?;

    let mut current_by_path: HashMap<String, AttachmentReferenceKind> = HashMap::new();
    for reference in references {
        current_by_path
            .entry(reference.asset_path)
            .or_insert(reference.reference_kind);
    }

    for (asset_path, reference_kind) in &current_by_path {
        // A link to a missing file can't be stored (references need an
        // attachment row). Reconciliation reports those links instead.
        if !ensure_attachment_record_for_existing_asset(conn, vault_path, asset_path)? {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO attachment_references (file_path, vault_path, asset_path, reference_kind, detected_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![key, vault, asset_path, reference_kind.as_str(), now],
        )
        .map_err(|e| format!("Failed to insert attachment reference: {}", e))?;
    }

    super::drawing_pictures::record_drawing_pictures(conn, vault_path, content)?;

    let mut touched = previous;
    touched.extend(
        current_by_path
            .into_keys()
            .map(|asset_path| (vault.clone(), asset_path)),
    );
    refresh_attachment_counts(conn, &touched)
}

/// One place a shard links to an external file, as written in the shard.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileUse {
    pub shard_path: String,
    pub link: String,
}

/// A file on this device that shards link to by a path outside the vault's
/// attachment folder, such as `images/a.png` or `C:\\Users\\me\\a.png`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFile {
    pub absolute_path: String,
    pub size_bytes: u64,
    pub inside_vault: bool,
    pub uses: Vec<ExternalFileUse>,
}

/// Every link destination in `content`: markdown images and links, and the
/// source attributes of HTML media tags, with HTML entities decoded.
fn parse_link_destinations(content: &str) -> Vec<String> {
    let mut destinations = Vec::new();

    for event in Parser::new(content) {
        match event {
            Event::Start(Tag::Image { dest_url, .. })
            | Event::Start(Tag::Link { dest_url, .. }) => {
                destinations.push(dest_url.to_string());
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                for attr_name in SOURCE_ATTRIBUTES {
                    if let Some(value) = extract_html_attr_value(&html, attr_name) {
                        destinations.push(unescape_attribute(&value));
                    }
                }
            }
            _ => {}
        }
    }

    destinations
}

/// The file a link destination points to on this device, if it is a local
/// path rather than a web address or anchor.
fn resolve_local_link(link: &str, shard_dir: &Path) -> Option<PathBuf> {
    let link = link.trim();
    if link.is_empty() || link.starts_with('#') {
        return None;
    }

    let is_windows_absolute = link.len() > 2
        && link.as_bytes()[0].is_ascii_alphabetic()
        && link.as_bytes()[1] == b':'
        && matches!(link.as_bytes()[2], b'\\' | b'/');
    let path_text = if let Some(rest) = link.strip_prefix("file://") {
        // file:///C:/a.png and file:///home/a.png
        let rest = rest.strip_prefix('/').filter(|r| {
            r.len() > 1 && r.as_bytes()[0].is_ascii_alphabetic() && r.as_bytes()[1] == b':'
        });
        rest.map(str::to_string)
            .unwrap_or_else(|| link["file://".len()..].to_string())
    } else if !is_windows_absolute
        && link.split_once(':').is_some_and(|(scheme, _)| {
            !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
        })
    {
        // http:, data:, mailto:, mention links and other schemes.
        return None;
    } else {
        link.split(['?', '#']).next().unwrap_or(link).to_string()
    };

    let decoded = decode(&path_text)
        .map(|value| value.into_owned())
        .unwrap_or(path_text);
    let path = Path::new(&decoded);
    let resolved = if path.is_absolute() || is_windows_absolute {
        path.to_path_buf()
    } else {
        shard_dir.join(path)
    };

    resolved.is_file().then_some(resolved)
}

/// Shard links to files that are not managed attachments: files elsewhere
/// in the vault or on this device. Notes and drawings are not attachments.
pub(crate) fn find_external_files(
    vault_path: &Path,
    shards: &[(String, String)],
) -> Vec<ExternalFile> {
    let attachments_dir = vault_path
        .join(ATTACHMENTS_DIR_NAME)
        .canonicalize()
        .unwrap_or_else(|_| vault_path.join(ATTACHMENTS_DIR_NAME));
    let vault = vault_path
        .canonicalize()
        .unwrap_or_else(|_| vault_path.to_path_buf());
    let mut by_path: HashMap<PathBuf, ExternalFile> = HashMap::new();

    for (shard_path, content) in shards {
        let shard_dir = Path::new(shard_path).parent().unwrap_or(vault_path);
        let mut seen = HashSet::new();

        for link in parse_link_destinations(content) {
            if normalize_attachment_path(&link).is_some() || !seen.insert(link.clone()) {
                continue;
            }
            let Some(resolved) = resolve_local_link(&link, shard_dir) else {
                continue;
            };
            let extension = extension_for_path(&resolved);
            if extension.is_empty()
                || matches!(
                    extension.as_str(),
                    "md" | "markdown" | "excalidraw" | "htm" | "html"
                )
            {
                continue;
            }
            let canonical = resolved.canonicalize().unwrap_or(resolved);
            if canonical.starts_with(&attachments_dir) {
                continue;
            }

            let size_bytes = std::fs::metadata(&canonical).map(|m| m.len()).unwrap_or(0);
            by_path
                .entry(canonical.clone())
                .or_insert_with(|| ExternalFile {
                    absolute_path: canonical.to_string_lossy().to_string(),
                    size_bytes,
                    inside_vault: canonical.starts_with(&vault),
                    uses: Vec::new(),
                })
                .uses
                .push(ExternalFileUse {
                    shard_path: shard_path.clone(),
                    link,
                });
        }
    }

    let mut files: Vec<ExternalFile> = by_path.into_values().collect();
    files.sort_by(|a, b| a.absolute_path.cmp(&b.absolute_path));
    files
}
