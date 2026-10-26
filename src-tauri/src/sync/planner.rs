//! Decides which vault files are backed up.
//!
//! Only shards (`.md`), drawings (`.excalidraw`) and managed attachments whose
//! policy allows sync are included. Everything else is reported as skipped
//! with a reason, so setup and sync can tell the user what stays on this device
//! instead of discovering it from a failed push.

use crate::db::attachments::{
    ATTACHMENTS_DIR_NAME, AttachmentSyncStatus, SYNC_SOFT_LIMIT_BYTES, extension_for_path,
    sync_status_for_attachment,
};
use crate::sync::state::has_vault_marker;
use crate::vault::{is_drawing_path, is_markdown_path};
use serde::Serialize;
use std::path::Path;

/// GitHub rejects files over 100 MB. Attachments already have a lower product
/// limit; this cap catches oversized shards and drawings (which can embed
/// images).
pub const GITHUB_FILE_LIMIT_BYTES: u64 = 100 * 1024 * 1024;

/// Folders never walked, in addition to hidden (`.`-prefixed) entries.
const IGNORED_DIRS: &[&str] = &["node_modules"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PlannedFileKind {
    Shard,
    Drawing,
    Attachment,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    /// Attachment type or size the policy keeps on this device.
    LocalOnly,
    /// Attachment type the policy never uploads (executables, scripts).
    Blocked,
    /// Attachment without an extension; needs the user's decision.
    PendingReview,
    /// Shard or drawing over GitHub's per-file limit.
    TooLarge,
    /// A file outside `_attachments/` that is not a shard or drawing.
    Unmanaged,
}

impl From<AttachmentSyncStatus> for Option<SkipReason> {
    fn from(status: AttachmentSyncStatus) -> Self {
        match status {
            AttachmentSyncStatus::Syncable => None,
            AttachmentSyncStatus::LocalOnly => Some(SkipReason::LocalOnly),
            AttachmentSyncStatus::Blocked => Some(SkipReason::Blocked),
            AttachmentSyncStatus::PendingReview => Some(SkipReason::PendingReview),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlannedFile {
    /// Vault-relative path with `/` separators, as stored in Git.
    pub path: String,
    pub size_bytes: u64,
    pub kind: PlannedFileKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    pub size_bytes: u64,
    pub reason: SkipReason,
    /// The size limit behind `reason`, when it is about size.
    pub limit_bytes: Option<u64>,
}

#[derive(Debug, Default)]
pub struct SyncPlan {
    pub included: Vec<PlannedFile>,
    pub skipped: Vec<SkippedFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPlanSummary {
    pub included_count: usize,
    pub shard_count: usize,
    pub drawing_count: usize,
    pub attachment_count: usize,
    pub included_bytes: u64,
    pub skipped: Vec<SkippedFile>,
}

impl SyncPlan {
    pub fn includes(&self, path: &str) -> bool {
        self.included
            .binary_search_by(|file| file.path.as_str().cmp(path))
            .is_ok()
    }

    pub fn summary(&self) -> SyncPlanSummary {
        let count = |kind| self.included.iter().filter(|f| f.kind == kind).count();
        SyncPlanSummary {
            included_count: self.included.len(),
            shard_count: count(PlannedFileKind::Shard),
            drawing_count: count(PlannedFileKind::Drawing),
            attachment_count: count(PlannedFileKind::Attachment),
            included_bytes: self.included.iter().map(|file| file.size_bytes).sum(),
            skipped: self.skipped.clone(),
        }
    }
}

/// Walks `vault_path` and classifies every file.
pub fn plan_vault(vault_path: &Path) -> Result<SyncPlan, String> {
    if !vault_path.is_dir() {
        return Err(format!("Vault folder not found: {}", vault_path.display()));
    }

    let mut plan = SyncPlan::default();
    walk(vault_path, "", &mut plan)?;
    plan.included.sort_by(|a, b| a.path.cmp(&b.path));
    plan.skipped.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(plan)
}

fn walk(dir: &Path, relative_dir: &str, plan: &mut SyncPlan) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry =
            entry.map_err(|e| format!("Failed to read entry in {}: {}", dir.display(), e))?;
        // Names Git can't store portably (non-UTF-8) are left out.
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }

        // Symlinks are never followed or stored: they could point outside the vault.
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let relative = if relative_dir.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", relative_dir, name)
        };

        if file_type.is_dir() {
            // Another vault inside this one keeps its own history.
            if !IGNORED_DIRS.contains(&name.as_str()) && !has_vault_marker(&entry.path()) {
                walk(&entry.path(), &relative, plan)?;
            }
        } else if file_type.is_file() {
            let size_bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
            classify(&entry.path(), relative, size_bytes, plan);
        }
    }

    Ok(())
}

/// Whether the vault file at `path` (`relative` in the vault) is backed up,
/// without walking the rest of the vault.
pub fn is_backed_up(path: &Path, relative: &str, size_bytes: u64) -> bool {
    outcome(path, relative, size_bytes).is_ok()
}

fn outcome(path: &Path, relative: &str, size_bytes: u64) -> Result<PlannedFileKind, SkipReason> {
    let in_attachments = relative.starts_with(&format!("{}/", ATTACHMENTS_DIR_NAME));

    let outcome = if in_attachments {
        let status = sync_status_for_attachment(&extension_for_path(path), size_bytes);
        Option::<SkipReason>::from(status).map_or(Ok(PlannedFileKind::Attachment), Err)
    } else if is_markdown_path(path) {
        Ok(PlannedFileKind::Shard)
    } else if is_drawing_path(path) {
        Ok(PlannedFileKind::Drawing)
    } else {
        Err(SkipReason::Unmanaged)
    };

    match outcome {
        Ok(_) if size_bytes > GITHUB_FILE_LIMIT_BYTES => Err(SkipReason::TooLarge),
        other => other,
    }
}

fn classify(path: &Path, relative: String, size_bytes: u64, plan: &mut SyncPlan) {
    match outcome(path, &relative, size_bytes) {
        Ok(kind) => plan.included.push(PlannedFile {
            path: relative,
            size_bytes,
            kind,
        }),
        Err(reason) => plan.skipped.push(SkippedFile {
            path: relative,
            size_bytes,
            reason,
            limit_bytes: match reason {
                SkipReason::LocalOnly => Some(SYNC_SOFT_LIMIT_BYTES),
                SkipReason::TooLarge => Some(GITHUB_FILE_LIMIT_BYTES),
                _ => None,
            },
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use std::fs;

    fn write(root: &Path, relative: &str, contents: &[u8]) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn includes_shards_drawings_and_syncable_attachments() {
        let vault = temp_dir("plan");
        write(&vault, "Note.md", b"# Note");
        write(&vault, "Projects/Plan.MD", b"# Plan");
        write(&vault, "Sketch.excalidraw", b"{}");
        write(&vault, "_attachments/photo.png", b"png");
        write(&vault, "_attachments/ab/0123.pdf", b"pdf");
        write(&vault, "_attachments/setup.exe", b"exe");
        write(&vault, "_attachments/scene.blend", b"blend");
        write(&vault, "_attachments/README", b"no extension");
        write(&vault, "images/diagram.png", b"png");
        write(&vault, ".netherstone/vault-id", b"abc");
        write(&vault, ".obsidian/app.json", b"{}");
        write(&vault, "node_modules/x/index.md", b"# no");

        let plan = plan_vault(&vault).unwrap();
        let included: Vec<_> = plan
            .included
            .iter()
            .map(|f| (f.path.as_str(), f.kind))
            .collect();
        assert_eq!(
            included,
            vec![
                ("Note.md", PlannedFileKind::Shard),
                ("Projects/Plan.MD", PlannedFileKind::Shard),
                ("Sketch.excalidraw", PlannedFileKind::Drawing),
                ("_attachments/ab/0123.pdf", PlannedFileKind::Attachment),
                ("_attachments/photo.png", PlannedFileKind::Attachment),
            ]
        );

        let skipped: Vec<_> = plan
            .skipped
            .iter()
            .map(|f| (f.path.as_str(), f.reason))
            .collect();
        assert_eq!(
            skipped,
            vec![
                ("_attachments/README", SkipReason::PendingReview),
                ("_attachments/scene.blend", SkipReason::LocalOnly),
                ("_attachments/setup.exe", SkipReason::Blocked),
                ("images/diagram.png", SkipReason::Unmanaged),
            ]
        );

        assert!(plan.includes("Note.md"));
        assert!(!plan.includes("images/diagram.png"));
        let summary = plan.summary();
        assert_eq!(summary.included_bytes, 6 + 6 + 2 + 3 + 3);
        assert_eq!(
            (
                summary.shard_count,
                summary.drawing_count,
                summary.attachment_count
            ),
            (2, 1, 2)
        );
    }

    #[test]
    fn oversized_files_are_skipped() {
        let vault = temp_dir("oversized");
        let big = vec![b'a'; (crate::db::attachments::SYNC_SOFT_LIMIT_BYTES + 1) as usize];
        write(&vault, "_attachments/huge.png", &big);

        let file = fs::File::create(vault.join("Huge.md")).unwrap();
        file.set_len(GITHUB_FILE_LIMIT_BYTES + 1).unwrap();

        let plan = plan_vault(&vault).unwrap();
        assert!(plan.included.is_empty());
        let reasons: Vec<_> = plan.skipped.iter().map(|f| f.reason).collect();
        assert_eq!(reasons, vec![SkipReason::TooLarge, SkipReason::LocalOnly]);
    }

    #[test]
    fn a_vault_inside_the_vault_is_left_out() {
        let vault = temp_dir("plan-nested");
        write(&vault, "Note.md", b"# Note");
        write(&vault, "Inner/.netherstone/vault-id", b"inner1\n");
        write(&vault, "Inner/Theirs.md", b"# Inner");
        write(&vault, "Folder/Mine.md", b"# Mine");

        let plan = plan_vault(&vault).unwrap();
        let included: Vec<_> = plan.included.iter().map(|f| f.path.as_str()).collect();
        assert_eq!(included, vec!["Folder/Mine.md", "Note.md"]);
    }
}
