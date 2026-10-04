//! Git sync engine.
//!
//! Each synced vault gets its own Git repository whose metadata lives in
//! AppData (`sync/<vault-id>/git`) while the vault folder itself is the work
//! tree, so the vault never contains a `.git` directory. What gets committed is
//! decided by the [`planner`], never by a blanket `git add .`.
//!
//! See `docs/GIT_SYNC_ARCHITECTURE.md` for the overall design.

pub mod conflicts;
pub mod merge;
pub mod planner;
pub mod remote;
pub mod repo;
pub mod state;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Serializes snapshot and upload work so two backups never touch the same
/// repository at once.
static GIT_LOCK: Mutex<()> = Mutex::new(());

/// Returns the directory holding per-vault sync data
/// (`<AppData>/com.netherstone.app/sync`).
pub fn sync_root() -> Result<PathBuf, String> {
    let root = crate::db::get_db_path()?
        .parent()
        .ok_or_else(|| "Failed to determine AppData directory".to_string())?
        .join("sync");

    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create sync directory: {}", e))?;

    Ok(root)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshotResult {
    pub vault_id: String,
    /// The new commit, or `None` when nothing changed since the last snapshot.
    pub commit: Option<repo::SnapshotCommit>,
    pub plan: planner::SyncPlanSummary,
}

/// Plans and commits the current state of `vault_path` to its local sync
/// repository, creating the repository on first use.
pub fn snapshot_vault(sync_root: &Path, vault_path: &Path) -> Result<VaultSnapshotResult, String> {
    let mut record = state::load_or_create_record(sync_root, vault_path)?;
    let plan = planner::plan_vault(vault_path)?;
    let git_dir = state::git_dir(sync_root, &record.vault_id);

    let repository = repo::open_or_init(&git_dir, vault_path)?;
    let commit = repo::commit_plan(&repository, &plan)?;

    if let Some(commit) = &commit {
        record.last_commit = Some(commit.id.clone());
        record.last_commit_at = Some(commit.time);
        state::save_record(sync_root, &record)?;
    }

    Ok(VaultSnapshotResult {
        vault_id: record.vault_id,
        commit,
        plan: plan.summary(),
    })
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn signed_in_token() -> Result<String, String> {
    crate::github::access_token()?.ok_or_else(|| "Connect GitHub first.".to_string())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncReport {
    pub record: state::VaultSyncRecord,
    /// Vault-relative paths changed on disk by changes from GitHub.
    pub changed: Vec<String>,
}

/// How many times a cycle restarts when another device uploads in between.
const SYNC_ATTEMPTS: usize = 3;

/// One sync cycle: commit local changes, download and merge GitHub's, write
/// them into the vault, and upload the result.
fn sync_cycle(
    sync_root: &Path,
    vault_path: &Path,
    remote_url: &str,
    token: &str,
) -> Result<SyncReport, String> {
    let _guard = GIT_LOCK.lock().map_err(|e| e.to_string())?;
    let mut changed = Vec::new();
    let mut conflicts = Vec::new();

    for attempt in 1..=SYNC_ATTEMPTS {
        let snapshot = snapshot_vault(sync_root, vault_path)?;
        let git_dir = state::git_dir(sync_root, &snapshot.vault_id);
        let repository = repo::open_or_init(&git_dir, vault_path)?;
        remote::set_remote(&repository, remote_url)?;

        if let Some(remote_head) = remote::fetch(&repository, token)? {
            let mut integration = merge::integrate(&repository, vault_path, remote_head)?;
            changed.append(&mut integration.changed);
            conflicts.append(&mut integration.conflicts);
            // Files edited while merging were kept; commit them on top.
            repo::commit_plan(&repository, &planner::plan_vault(vault_path)?)?;
        }

        match remote::push(&repository, token) {
            Ok(()) => break,
            Err(e) if e == remote::BEHIND_MESSAGE && attempt < SYNC_ATTEMPTS => continue,
            Err(e) => return Err(e),
        }
    }

    let mut record = state::load_or_create_record(sync_root, vault_path)?;
    let repository = repo::open_or_init(&state::git_dir(sync_root, &record.vault_id), vault_path)?;
    let head = repository.head().ok().and_then(|h| h.peel_to_commit().ok());
    record.last_commit = head.as_ref().map(|c| c.id().to_string());
    record.last_commit_at = head.as_ref().map(|c| c.time().seconds());
    record.last_sync_at = Some(now_unix_seconds());
    let detected_at = now_unix_seconds();
    for conflict in conflicts {
        // A newer GitHub version of the same file replaces the older one.
        record.conflicts.retain(|existing| existing.path != conflict.path);
        record.conflicts.push(state::SyncConflict {
            path: conflict.path,
            theirs: conflict.theirs.to_string(),
            detected_at,
        });
    }
    state::save_record(sync_root, &record)?;

    changed.sort();
    changed.dedup();
    Ok(SyncReport { record, changed })
}

async fn run_blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

/// Turns on backup for a vault: creates its private GitHub repository (or
/// reuses one created by an earlier attempt that didn't finish), then runs
/// the first sync.
pub async fn turn_on_backup(sync_root: PathBuf, vault_path: PathBuf) -> Result<SyncReport, String> {
    let token = signed_in_token()?;
    let client = crate::github::http_client()?;
    let installation = crate::github::current_installation(&client, &token)
        .await?
        .ok_or_else(|| {
            "Install the Netherstone app on GitHub first, then try again.".to_string()
        })?;

    let mut record = {
        let (root, vault) = (sync_root.clone(), vault_path.clone());
        run_blocking(move || state::load_or_create_record(&root, &vault)).await?
    };

    let existing = match (&record.repo_name, &record.remote_url) {
        (Some(name), Some(url))
            if crate::github::repos::repo_exists(&client, &token, name).await? =>
        {
            Some(url.clone())
        }
        _ => None,
    };

    let remote_url = match existing {
        Some(url) => url,
        None => {
            let vault_name = vault_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let repo =
                crate::github::repos::create_backup_repo(&client, &token, &vault_name).await?;
            // An installation limited to selected repositories can't push to a
            // repository it hasn't been given yet.
            crate::github::app::add_repository(&client, &token, &installation, repo.id).await?;
            // Saved before uploading so a failed first upload reuses this repository.
            record.repo_name = Some(repo.full_name);
            record.remote_url = Some(repo.clone_url.clone());
            let (root, saved) = (sync_root.clone(), record.clone());
            run_blocking(move || state::save_record(&root, &saved)).await?;
            repo.clone_url
        }
    };

    run_blocking(move || {
        let mut report = sync_cycle(&sync_root, &vault_path, &remote_url, &token)?;
        report.record.sync_enabled = true;
        state::save_record(&sync_root, &report.record)?;
        Ok(report)
    })
    .await
}

/// The signed-in user's backups on GitHub.
pub async fn list_backups() -> Result<Vec<crate::github::repos::BackupSummary>, String> {
    let token = signed_in_token()?;
    let client = crate::github::http_client()?;
    crate::github::repos::list_backups(&client, &token).await
}

/// Connects a vault to an existing backup and syncs it, downloading the
/// backup's files. Files already in the vault are kept and uploaded; where
/// both have the same file with different contents, that's a conflict.
pub async fn connect_backup(
    sync_root: PathBuf,
    vault_path: PathBuf,
    full_name: String,
    clone_url: String,
) -> Result<SyncReport, String> {
    let token = signed_in_token()?;
    if !clone_url.starts_with("https://github.com/") {
        return Err("That isn't a GitHub repository.".to_string());
    }

    run_blocking(move || {
        let mut record = state::load_or_create_record(&sync_root, &vault_path)?;
        record.repo_name = Some(full_name);
        record.remote_url = Some(clone_url.clone());
        state::save_record(&sync_root, &record)?;

        let mut report = sync_cycle(&sync_root, &vault_path, &clone_url, &token)?;
        report.record.sync_enabled = true;
        state::save_record(&sync_root, &report.record)?;
        Ok(report)
    })
    .await
}

/// Syncs a vault that has backup turned on.
pub async fn sync_now(sync_root: PathBuf, vault_path: PathBuf) -> Result<SyncReport, String> {
    let token = signed_in_token()?;
    run_blocking(move || {
        let record = state::load_or_create_record(&sync_root, &vault_path)?;
        let remote_url = match (&record.remote_url, record.sync_enabled) {
            (Some(url), true) => url.clone(),
            _ => return Err("Backup isn't turned on for this vault.".to_string()),
        };
        sync_cycle(&sync_root, &vault_path, &remote_url, &token)
    })
    .await
}

/// Stops backing up a vault. The GitHub repository and the local history are
/// kept, so turning backup back on continues where it left off.
pub fn turn_off_backup(
    sync_root: &Path,
    vault_path: &Path,
) -> Result<state::VaultSyncRecord, String> {
    let mut record = state::load_or_create_record(sync_root, vault_path)?;
    record.sync_enabled = false;
    state::save_record(sync_root, &record)?;
    Ok(record)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn snapshot_commits_once_and_skips_unchanged_vaults() {
        let dir = state::tests::temp_dir("snapshot");
        let vault = dir.join("vault");
        let sync_root = dir.join("sync");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "# Hello").unwrap();

        let first = snapshot_vault(&sync_root, &vault).unwrap();
        let commit = first.commit.expect("first snapshot should commit");
        assert_eq!(commit.added, 1);
        assert_eq!(first.plan.included_count, 1);
        assert!(!vault.join(".git").exists());
        assert!(
            state::git_dir(&sync_root, &first.vault_id)
                .join("HEAD")
                .exists()
        );

        let second = snapshot_vault(&sync_root, &vault).unwrap();
        assert_eq!(second.vault_id, first.vault_id);
        assert!(second.commit.is_none());

        let record = state::load_or_create_record(&sync_root, &vault).unwrap();
        assert_eq!(record.last_commit.as_deref(), Some(commit.id.as_str()));
        assert!(!record.sync_enabled);
    }
}
