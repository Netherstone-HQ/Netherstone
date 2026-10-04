//! Choosing a version for a file that changed both here and on GitHub.

use super::state::{self, SyncConflict, VaultSyncRecord};
use super::{GIT_LOCK, repo};
use git2::{Oid, Repository};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Previews are cut to this many characters on each side.
const PREVIEW_CHARS: usize = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictChoice {
    /// Replace this device's version with GitHub's.
    GitHub,
    /// Keep this device's version; it's uploaded on the next sync.
    ThisDevice,
    /// GitHub's version takes the name; this device's is saved alongside.
    Both,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictVersions {
    pub path: String,
    /// `None` when the file is no longer on this device, or isn't text.
    pub this_device: Option<String>,
    pub github: Option<String>,
    pub this_device_bytes: Option<u64>,
    pub github_bytes: u64,
}

fn find_conflict<'a>(record: &'a VaultSyncRecord, path: &str) -> Result<&'a SyncConflict, String> {
    record
        .conflicts
        .iter()
        .find(|conflict| conflict.path == path)
        .ok_or_else(|| "This file no longer needs a decision.".to_string())
}

fn github_bytes(repository: &Repository, conflict: &SyncConflict) -> Result<Vec<u8>, String> {
    let id = Oid::from_str(&conflict.theirs).map_err(|e| e.message().to_string())?;
    repository
        .find_blob(id)
        .map(|blob| blob.content().to_vec())
        .map_err(|_| "GitHub's version of this file is no longer available.".to_string())
}

fn preview(bytes: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(bytes).ok()?;
    Some(text.chars().take(PREVIEW_CHARS).collect())
}

fn open_repository(
    sync_root: &Path,
    vault_path: &Path,
    record: &VaultSyncRecord,
) -> Result<Repository, String> {
    repo::open_or_init(&state::git_dir(sync_root, &record.vault_id), vault_path)
}

/// Both versions of a conflicted file, for a side-by-side preview.
pub fn conflict_versions(
    sync_root: &Path,
    vault_path: &Path,
    path: &str,
) -> Result<ConflictVersions, String> {
    let record = state::load_or_create_record(sync_root, vault_path)?;
    let conflict = find_conflict(&record, path)?;
    let repository = open_repository(sync_root, vault_path, &record)?;
    let github = github_bytes(&repository, conflict)?;
    let local = std::fs::read(vault_path.join(path)).ok();

    Ok(ConflictVersions {
        path: path.to_string(),
        this_device: local.as_deref().and_then(preview),
        github: preview(&github),
        this_device_bytes: local.as_ref().map(|bytes| bytes.len() as u64),
        github_bytes: github.len() as u64,
    })
}

/// `Note.md` → `Note (This device).md`, numbered if that name is taken.
fn this_device_copy_path(path: &Path) -> PathBuf {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let extension = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();

    (1..)
        .map(|n| {
            let suffix = if n == 1 {
                "This device".to_string()
            } else {
                format!("This device {}", n)
            };
            path.with_file_name(format!("{} ({}){}", stem, suffix, extension))
        })
        .find(|candidate| !candidate.exists())
        .expect("an unused name exists")
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    std::fs::write(path, bytes).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

/// Applies the user's choice for one conflicted file. The next sync uploads
/// the result.
pub fn resolve_conflict(
    sync_root: &Path,
    vault_path: &Path,
    path: &str,
    choice: ConflictChoice,
) -> Result<VaultSyncRecord, String> {
    let _guard = GIT_LOCK.lock().map_err(|e| e.to_string())?;
    let mut record = state::load_or_create_record(sync_root, vault_path)?;
    let conflict = find_conflict(&record, path)?.clone();
    let target = vault_path.join(&conflict.path);

    if choice != ConflictChoice::ThisDevice {
        let repository = open_repository(sync_root, vault_path, &record)?;
        let github = github_bytes(&repository, &conflict)?;
        if choice == ConflictChoice::Both && target.exists() {
            let copy = this_device_copy_path(&target);
            std::fs::rename(&target, &copy)
                .map_err(|e| format!("Failed to keep this device's version: {}", e))?;
        }
        write_file(&target, &github)?;
    }

    record
        .conflicts
        .retain(|existing| existing.path != conflict.path);
    state::save_record(sync_root, &record)?;
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use std::fs;

    /// A vault whose record has one conflict on `Note.md`, with GitHub's
    /// version stored in the sync repository.
    fn vault_with_conflict(name: &str) -> (PathBuf, PathBuf) {
        let dir = temp_dir(name);
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "this device").unwrap();

        let mut record = state::load_or_create_record(&sync_root, &vault).unwrap();
        let repository = open_repository(&sync_root, &vault, &record).unwrap();
        let theirs = repository.blob(b"from github").unwrap();
        record.conflicts.push(SyncConflict {
            path: "Note.md".into(),
            theirs: theirs.to_string(),
            detected_at: 0,
        });
        state::save_record(&sync_root, &record).unwrap();
        (vault, sync_root)
    }

    #[test]
    fn previews_both_versions() {
        let (vault, sync_root) = vault_with_conflict("conflict-preview");
        let versions = conflict_versions(&sync_root, &vault, "Note.md").unwrap();
        assert_eq!(versions.this_device.as_deref(), Some("this device"));
        assert_eq!(versions.github.as_deref(), Some("from github"));
    }

    #[test]
    fn keeps_github_version() {
        let (vault, sync_root) = vault_with_conflict("conflict-github");
        let record =
            resolve_conflict(&sync_root, &vault, "Note.md", ConflictChoice::GitHub).unwrap();
        assert!(record.conflicts.is_empty());
        assert_eq!(
            fs::read_to_string(vault.join("Note.md")).unwrap(),
            "from github"
        );
    }

    #[test]
    fn keeps_this_devices_version() {
        let (vault, sync_root) = vault_with_conflict("conflict-local");
        resolve_conflict(&sync_root, &vault, "Note.md", ConflictChoice::ThisDevice).unwrap();
        assert_eq!(
            fs::read_to_string(vault.join("Note.md")).unwrap(),
            "this device"
        );
        assert!(resolve_conflict(&sync_root, &vault, "Note.md", ConflictChoice::GitHub).is_err());
    }

    #[test]
    fn keeps_both_versions() {
        let (vault, sync_root) = vault_with_conflict("conflict-both");
        fs::write(vault.join("Note (This device).md"), "older copy").unwrap();
        resolve_conflict(&sync_root, &vault, "Note.md", ConflictChoice::Both).unwrap();
        assert_eq!(
            fs::read_to_string(vault.join("Note.md")).unwrap(),
            "from github"
        );
        assert_eq!(
            fs::read_to_string(vault.join("Note (This device 2).md")).unwrap(),
            "this device"
        );
    }
}
