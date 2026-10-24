//! Git sync engine.
//!
//! Each synced vault gets its own Git repository whose metadata lives in
//! AppData (`sync/<vault-id>/git`) while the vault folder itself is the work
//! tree, so the vault never contains a `.git` directory. What gets committed is
//! decided by the [`planner`], never by a blanket `git add .`.
//!
//! See `docs/GIT_SYNC_ARCHITECTURE.md` for the overall design.

pub mod changes;
pub mod conflicts;
pub mod drawing_merge;
pub mod history;
pub mod writing;
pub mod merge;
pub mod planner;
pub mod remote;
pub mod repo;
pub mod state;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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

/// Saves a version of `vault_path`: plans and commits its current state to
/// its local repository, creating the repository on first use. Every vault
/// has this history, with or without sync.
pub fn snapshot_vault(sync_root: &Path, vault_path: &Path) -> Result<VaultSnapshotResult, String> {
    let _guard = crate::locks::history(sync_root)?;
    snapshot_locked(sync_root, vault_path)
}

/// Saves `previous` as the last version of the vault file `file_path`, then a
/// version of the whole vault. Called when a file changed outside the app, so
/// the text the app last saved and the outside change are both kept, whatever
/// is saved next.
pub fn snapshot_outside_change(
    sync_root: &Path,
    vault_path: &Path,
    file_path: &Path,
    previous: &str,
) -> Result<VaultSnapshotResult, String> {
    let _guard = crate::locks::history(sync_root)?;
    let relative = vault_relative(vault_path, file_path)?;
    let plan = planner::plan_vault(vault_path)?;
    let note = plan.includes(&relative).then(|| history::Note::OutsideChange {
        path: relative.clone(),
    });
    if note.is_some() {
        let record = state::load_or_create_record(sync_root, vault_path)?;
        let repository =
            repo::open_or_init(&state::git_dir(sync_root, &record.vault_id), vault_path)?;
        repo::commit_file_version(&repository, &relative, previous.as_bytes())?;
    }
    commit_snapshot(sync_root, vault_path, plan, note)
}

/// `file_path` relative to the vault, with `/` separators, as the history
/// stores it.
pub fn vault_relative(vault_path: &Path, file_path: &Path) -> Result<String, String> {
    file_path
        .strip_prefix(vault_path)
        .ok()
        .and_then(Path::to_str)
        .map(|path| path.replace('\\', "/"))
        .ok_or_else(|| format!("Not in the vault: {}", file_path.display()))
}

fn snapshot_locked(sync_root: &Path, vault_path: &Path) -> Result<VaultSnapshotResult, String> {
    commit_snapshot(sync_root, vault_path, planner::plan_vault(vault_path)?, None)
}

fn commit_snapshot(
    sync_root: &Path,
    vault_path: &Path,
    plan: planner::SyncPlan,
    note: Option<history::Note>,
) -> Result<VaultSnapshotResult, String> {
    let mut record = state::load_or_create_record(sync_root, vault_path)?;
    let git_dir = state::git_dir(sync_root, &record.vault_id);

    let repository = repo::open_or_init(&git_dir, vault_path)?;
    let note = note.map(|note| note.to_string());
    let commit = repo::commit_plan_noted(&repository, &plan, note.as_deref())?;

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
    let _sync = crate::locks::sync(sync_root)?;
    let mut changed = Vec::new();
    let mut conflicts = Vec::new();

    // history.lock is only held for the local steps, so saving a version,
    // restoring or settling a conflict never waits on GitHub.
    for attempt in 1..=SYNC_ATTEMPTS {
        let repository = {
            let _history = crate::locks::history(sync_root)?;
            let snapshot = snapshot_locked(sync_root, vault_path)?;
            let git_dir = state::git_dir(sync_root, &snapshot.vault_id);
            let repository = repo::open_or_init(&git_dir, vault_path)?;
            remote::set_remote(&repository, remote_url)?;
            repository
        };

        if let Some(remote_head) = remote::fetch(&repository, token)? {
            let _history = crate::locks::history(sync_root)?;
            // Changes saved while downloading go in first.
            snapshot_locked(sync_root, vault_path)?;
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

    let _history = crate::locks::history(sync_root)?;
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

    #[test]
    fn an_outside_change_keeps_both_versions() {
        let dir = state::tests::temp_dir("outside-change");
        let vault = dir.join("vault");
        let sync_root = dir.join("sync");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "first").unwrap();
        snapshot_vault(&sync_root, &vault).unwrap();

        // Saved by the app, then changed outside before the next version.
        fs::write(vault.join("Note.md"), "outside").unwrap();
        let result =
            snapshot_outside_change(&sync_root, &vault, &vault.join("Note.md"), "mine").unwrap();
        assert!(result.commit.is_some());

        let repository =
            repo::open_or_init(&state::git_dir(&sync_root, &result.vault_id), &vault).unwrap();
        let mut walk = repository.revwalk().unwrap();
        walk.push_head().unwrap();
        let versions: Vec<Vec<u8>> = walk
            .map(|id| {
                let tree = repository.find_commit(id.unwrap()).unwrap().tree().unwrap();
                let entry = tree.get_path(Path::new("Note.md")).unwrap();
                repository.find_blob(entry.id()).unwrap().content().to_vec()
            })
            .collect();
        assert_eq!(versions, [&b"outside"[..], b"mine", b"first"]);
    }
}
