//! What a list of shards shows under each name: when it was last edited and
//! the start of its text.

use crate::markdown_text::{BlockKind, text_blocks};
use crate::vault_access::in_open_vault;
use serde::Serialize;
use std::path::Path;
use std::time::UNIX_EPOCH;

/// Characters a preview keeps before it's cut with "…".
const PREVIEW_CHARS: usize = 120;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShardPreview {
    pub path: String,
    /// Seconds since 1970, or None when the file can't be read.
    pub last_modified: Option<i64>,
    /// The first text that isn't a heading, or None for a drawing or a
    /// shard with only headings.
    pub preview: Option<String>,
}

/// The first text of `markdown` that isn't a heading, cut at a whole word.
fn preview_of(markdown: &str) -> Option<String> {
    let text = text_blocks(markdown)
        .into_iter()
        .find(|block| !matches!(block.kind, BlockKind::Heading { .. }))?
        .text;
    if text.chars().count() <= PREVIEW_CHARS {
        return Some(text);
    }
    let cut: String = text.chars().take(PREVIEW_CHARS).collect();
    let whole = cut.rfind(' ').map_or(cut.as_str(), |at| &cut[..at]);
    Some(format!("{}…", whole.trim_end()))
}

fn modified_secs(path: &Path) -> Option<i64> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(modified.duration_since(UNIX_EPOCH).ok()?.as_secs() as i64)
}

fn preview_file(path: &str) -> ShardPreview {
    let file = Path::new(path);
    let is_markdown = file
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("md"));
    ShardPreview {
        path: path.to_string(),
        last_modified: modified_secs(file),
        preview: if is_markdown {
            std::fs::read_to_string(file).ok().and_then(|text| preview_of(&text))
        } else {
            None
        },
    }
}

/// Previews of the shards and drawings at `paths`, in the same order.
#[tauri::command(async)]
pub(crate) fn get_shard_previews(paths: Vec<String>) -> Result<Vec<ShardPreview>, String> {
    for path in &paths {
        in_open_vault(path)?;
    }
    Ok(paths.iter().map(|path| preview_file(path)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    #[test]
    fn preview_skips_headings() {
        assert_eq!(
            preview_of("# Overview\n\nHow Netherstone is put together.\n").as_deref(),
            Some("How Netherstone is put together.")
        );
    }

    #[test]
    fn preview_of_only_headings_is_none() {
        assert_eq!(preview_of("# Title\n\n## Part\n"), None);
    }

    #[test]
    fn long_preview_is_cut_at_a_word() {
        let long = "word ".repeat(60);
        let preview = preview_of(&long).unwrap();
        assert!(preview.ends_with("word…"));
        assert!(preview.chars().count() <= PREVIEW_CHARS + 1);
    }

    #[test]
    fn drawing_has_no_preview_but_a_date() {
        let dir = temp_dir("previews");
        let drawing = dir.join("Sketch.excalidraw");
        std::fs::write(&drawing, "{}").unwrap();
        let preview = preview_file(drawing.to_str().unwrap());
        assert_eq!(preview.preview, None);
        assert!(preview.last_modified.is_some());
    }

    #[test]
    fn missing_file_has_neither() {
        let dir = temp_dir("previews-missing");
        let preview = preview_file(dir.join("Gone.md").to_str().unwrap());
        assert_eq!(preview.last_modified, None);
        assert_eq!(preview.preview, None);
    }
}
