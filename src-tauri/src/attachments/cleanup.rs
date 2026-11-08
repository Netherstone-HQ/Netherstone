//! Cleanup: moving unused attachments out and pruning empty folders.

use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

use super::policy::{
    ATTACHMENTS_DIR_NAME, is_interrupted_write, is_system_file, path_from_asset_path,
};
use super::report::{UnusedAttachment, reconcile_vault_attachments};
use crate::db::attachments::vault_key;

/// Removes folders under `_attachments` that hold no attachments, such as
/// emptied old two-letter hash folders. Folders holding only system
/// files count as empty. The `_attachments` folder itself stays.
pub(crate) fn prune_empty_attachment_folders(vault_path: &Path) {
    fn prune(dir: &Path) -> bool {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return false;
        };
        let mut is_empty = true;
        let mut system_files = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => {
                    if !prune(&path) || std::fs::remove_dir(&path).is_err() {
                        is_empty = false;
                    }
                }
                Ok(kind)
                    if kind.is_file() && is_system_file(&entry.file_name().to_string_lossy()) =>
                {
                    system_files.push(path);
                }
                _ => is_empty = false,
            }
        }
        if is_empty {
            for file in system_files {
                if std::fs::remove_file(&file).is_err() {
                    return false;
                }
            }
        }
        is_empty
    }

    prune(&vault_path.join(ATTACHMENTS_DIR_NAME));
}

/// How long a file must stay unused before cleanup removes it, so a link
/// that is removed and soon restored (an undo, a cut and paste) keeps its
/// file.
pub const CLEANUP_GRACE_SECONDS: i64 = 7 * 24 * 60 * 60;

/// What cleanup did.
#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub removed: Vec<String>,
    pub freed_bytes: u64,
    /// Requested files that were kept: linked again, too recently unused,
    /// or not removable.
    pub kept: Vec<String>,
}

/// Whether an unused file has been unused long enough to remove. Leftovers
/// from an interrupted write always qualify.
pub fn is_ready_for_cleanup(file: &UnusedAttachment, now: i64) -> bool {
    is_interrupted_write(&file.asset_path)
        || file
            .unused_since
            .is_some_and(|since| now - since >= CLEANUP_GRACE_SECONDS)
}

/// Moves the requested unused attachments to the trash with `remove`,
/// after re-checking the vault so that a file linked again since the
/// preview is never removed. Removes their database rows and any folder
/// left empty under `_attachments`.
pub fn clean_up_vault_attachments(
    conn: &Connection,
    vault_path: &Path,
    markdown_paths: &[String],
    asset_paths: &[String],
    now: i64,
    remove: impl Fn(&Path) -> Result<(), String>,
) -> Result<CleanupResult, String> {
    let report = reconcile_vault_attachments(conn, vault_path, markdown_paths)?;
    let ready: HashMap<&str, &UnusedAttachment> = report
        .unused
        .iter()
        .filter(|file| is_ready_for_cleanup(file, now))
        .map(|file| (file.asset_path.as_str(), file))
        .collect();
    let attachments_dir = vault_path.join(ATTACHMENTS_DIR_NAME);
    let mut result = CleanupResult::default();

    for asset_path in asset_paths {
        let Some(file) = ready.get(asset_path.as_str()) else {
            result.kept.push(asset_path.clone());
            continue;
        };
        let Ok(path) = path_from_asset_path(vault_path, asset_path) else {
            result.kept.push(asset_path.clone());
            continue;
        };
        if !path.starts_with(&attachments_dir) {
            result.kept.push(asset_path.clone());
            continue;
        }

        if let Err(error) = remove(&path) {
            eprintln!(
                "[Netherstone] Failed to remove attachment {}: {}",
                asset_path, error
            );
            result.kept.push(asset_path.clone());
            continue;
        }

        conn.execute(
            "DELETE FROM attachments WHERE vault_path = ?1 AND asset_path = ?2 AND ref_count = 0",
            params![vault_key(vault_path), asset_path],
        )
        .map_err(|e| format!("Failed to forget removed attachment: {}", e))?;
        result.freed_bytes += file.size_bytes;
        result.removed.push(asset_path.clone());

        // Drop folders the removal emptied, such as old hash folders.
        let mut dir = path.parent();
        while let Some(current) = dir {
            if current == attachments_dir || !current.starts_with(&attachments_dir) {
                break;
            }
            if std::fs::remove_dir(current).is_err() {
                break;
            }
            dir = current.parent();
        }
    }

    Ok(result)
}
