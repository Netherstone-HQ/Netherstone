//! A shard's or drawing's earlier versions: listing them, comparing one with
//! the file as it is, and bringing one back.

use super::edits::read_text;
use super::find::local_date;
use super::{Caller, Page, ToolError, ToolResult, Vault};
use crate::sync::history::{FileVersion, VersionKind, list_versions, read_version};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

pub const HISTORY: &str = "A shard's or drawing's History: every version saved, \
newest first. list gives each version's id, when and how it was made (by an \
AI app too) and how much changed. diff shows what a version has that the file \
doesn't now, and the other way round. read gives a version's whole text. \
restore brings a version back; the file as it is now is saved first, so a \
restore can be undone too.";

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum HistoryAction {
    List,
    Diff,
    Read,
    Restore,
}

#[derive(Deserialize, JsonSchema)]
pub struct HistoryParams {
    /// The shard or drawing, vault-relative.
    path: String,
    action: HistoryAction,
    /// For diff, read and restore: the version's id, from list.
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
pub struct Version {
    version: String,
    saved: String,
    how: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    changed_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    device: Option<String>,
    /// Words for shards, shapes for drawings, against the version before.
    added: usize,
    removed: usize,
    /// True for the version the file holds now.
    current: bool,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum HistoryResult {
    Versions {
        path: String,
        versions: Vec<Version>,
        #[serde(skip_serializing_if = "Option::is_none")]
        next_cursor: Option<String>,
    },
    Text {
        version: String,
        content: String,
    },
    Diff {
        version: String,
        /// Lines starting with - are in the version only, + in the file now.
        diff: String,
    },
    Restored {
        path: String,
        restored: String,
    },
}

fn how(kind: VersionKind) -> &'static str {
    match kind {
        VersionKind::Created => "created",
        VersionKind::Edited => "edited",
        VersionKind::OutsideChange => "changed outside the app",
        VersionKind::Restored => "restored",
        VersionKind::Synced => "synced from another device",
        VersionKind::Renamed => "renamed or moved",
        VersionKind::ChangedByApp => "changed by an AI app",
    }
}

fn shown(version: FileVersion, current: bool) -> Version {
    Version {
        version: version.blob,
        saved: local_date(version.time),
        how: how(version.kind),
        changed_by: version.changed_by,
        summary: version.summary,
        device: version.device,
        added: version.added,
        removed: version.removed,
        current,
    }
}

pub fn history(vault: &Vault, _: &Caller, params: HistoryParams) -> ToolResult<HistoryResult> {
    let path = vault.resolve(&params.path)?;
    let is_drawing = crate::vault::is_drawing_path(&path);
    if !is_drawing && !crate::vault::is_markdown_path(&path) {
        return Err(ToolError(format!("'{}' isn't a shard or drawing", params.path)));
    }
    let history = list_versions(&vault.sync_root, &vault.root, &path)?;
    let find = |id: &str| -> ToolResult<FileVersion> {
        history
            .current
            .iter()
            .chain(&history.versions)
            .find(|version| version.blob == id || version.id == id)
            .cloned()
            .ok_or_else(|| ToolError(format!("'{}' isn't a version of {}. List them first.", id, params.path)))
    };
    let version = || -> ToolResult<FileVersion> {
        find(params.version.as_deref().ok_or_else(|| ToolError("This needs the version's id".to_string()))?)
    };

    match params.action {
        HistoryAction::List => {
            let page = Page::new(params.cursor.as_deref(), params.limit)?;
            let all: Vec<Version> = history
                .current
                .clone()
                .map(|now| shown(now, true))
                .into_iter()
                .chain(history.versions.clone().into_iter().map(|v| shown(v, false)))
                .collect();
            let (versions, next_cursor) = page.of(all);
            Ok(HistoryResult::Versions {
                path: vault.relative(&path),
                versions,
                next_cursor,
            })
        }
        HistoryAction::Read => {
            let version = version()?;
            Ok(HistoryResult::Text {
                content: read_version(&vault.sync_root, &vault.root, &version.blob)?,
                version: version.blob,
            })
        }
        HistoryAction::Diff => {
            let version = version()?;
            let old = read_version(&vault.sync_root, &vault.root, &version.blob)?;
            let now = if path.is_file() { read_text(&path)? } else { String::new() };
            let diff = similar::TextDiff::from_lines(&old, &now)
                .unified_diff()
                .header("version", "now")
                .to_string();
            Ok(HistoryResult::Diff {
                version: version.blob,
                diff: if diff.is_empty() { "The file is the same as this version.".to_string() } else { diff },
            })
        }
        HistoryAction::Restore => {
            let version = version()?;
            crate::sync::history::restore(
                &vault.sync_root,
                &vault.root,
                &path,
                &version.blob,
                version.time,
                |content| {
                    let writes = crate::locks::vault_writes()?;
                    if let Some(folder) = path.parent().filter(|folder| !folder.exists()) {
                        std::fs::create_dir_all(folder)
                            .map_err(|e| format!("Failed to create folder {}: {}", folder.display(), e))?;
                    }
                    if is_drawing {
                        crate::vault::write_atomically(&writes, &path, content.as_bytes())
                    } else {
                        crate::write_shard(&writes, &vault.root, &path.to_string_lossy(), content)
                    }
                },
            )?;
            super::edits::reindex(vault, &path);
            Ok(HistoryResult::Restored {
                path: vault.relative(&path),
                restored: local_date(version.time),
            })
        }
    }
}
