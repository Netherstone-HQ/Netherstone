//! Backup, sync and history commands, and the histories of vaults whose
//! folder is gone.

use crate::shards::{drawings::write_drawing_file, write_markdown_file_if_unchanged};
use crate::vault_access::{self, in_open_vault, open_vault_only};
use crate::{db, github, gone_vaults, sync, vault};
use std::path::Path;

#[tauri::command(async)]
pub(crate) fn sync_get_vault_record(
    vault_path: String,
) -> Result<Option<sync::state::VaultSyncRecord>, String> {
    open_vault_only(&vault_path)?;
    sync::state::find_record(&sync::sync_root()?, Path::new(&vault_path))
}

#[tauri::command(async)]
pub(crate) fn find_nested_vault(
    folder: String,
) -> Result<Option<sync::state::NestedVault>, String> {
    Ok(sync::state::find_nested_vault(
        &sync::sync_root()?,
        Path::new(&folder),
    ))
}

#[tauri::command(async)]
pub(crate) fn sync_plan_vault(
    vault_path: String,
) -> Result<sync::planner::SyncPlanSummary, String> {
    open_vault_only(&vault_path)?;
    Ok(sync::planner::plan_vault(Path::new(&vault_path))?.summary())
}

#[tauri::command]
pub(crate) async fn sync_turn_on_backup(vault_path: String) -> Result<sync::SyncReport, String> {
    open_vault_only(&vault_path)?;
    sync::turn_on_backup(sync::sync_root()?, vault_path.into()).await
}

#[tauri::command]
pub(crate) async fn sync_now(vault_path: String) -> Result<sync::SyncReport, String> {
    open_vault_only(&vault_path)?;
    sync::sync_now(sync::sync_root()?, vault_path.into()).await
}

/// Old versions of the open vault's attachments still in its history.
#[tauri::command(async)]
pub(crate) fn history_old_attachments(
    vault_path: String,
) -> Result<Vec<sync::space::OldAttachment>, String> {
    open_vault_only(&vault_path)?;
    sync::space::old_attachments(&sync::sync_root()?, Path::new(&vault_path))
}

/// Removes the picked old attachment versions from the vault's history.
#[tauri::command]
pub(crate) async fn history_free_up_space(
    vault_path: String,
    blobs: Vec<String>,
) -> Result<sync::space::Freed, String> {
    open_vault_only(&vault_path)?;
    sync::free_up_space(sync::sync_root()?, vault_path.into(), blobs).await
}

/// Forgets the vaults whose folder is gone, of the ones the app keeps
/// something for and the `recent` ones the window lists, and returns them.
#[tauri::command(async)]
pub(crate) fn forget_gone_vaults(recent: Vec<String>) -> Result<Vec<String>, String> {
    let recent: Vec<std::path::PathBuf> = recent.into_iter().map(Into::into).collect();
    Ok(gone_vaults::forget(&recent)?
        .into_iter()
        .map(|vault| vault.to_string_lossy().into_owned())
        .collect())
}

/// The histories of vaults whose folder is gone.
#[tauri::command(async)]
pub(crate) fn gone_vault_histories() -> Result<Vec<gone_vaults::GoneHistory>, String> {
    gone_vaults::histories(&db::open_connection()?, &sync::sync_root()?)
}

/// Moves the history of a vault whose folder is gone to the OS trash.
/// Resolves to the bytes freed.
#[tauri::command(async)]
pub(crate) fn delete_gone_vault_history(vault_id: String) -> Result<u64, String> {
    gone_vaults::delete_history(
        &db::open_connection()?,
        &sync::sync_root()?,
        &vault_id,
        |path| trash::delete(path).map_err(|e| e.to_string()),
    )
}

#[tauri::command]
pub(crate) async fn sync_list_backups() -> Result<Vec<github::repos::BackupSummary>, String> {
    sync::list_backups().await
}

#[tauri::command]
pub(crate) async fn sync_connect_backup(
    vault_path: String,
    full_name: String,
    clone_url: String,
) -> Result<sync::SyncReport, String> {
    open_vault_only(&vault_path)?;
    sync::connect_backup(sync::sync_root()?, vault_path.into(), full_name, clone_url).await
}

/// Whether the backup can go into a vault about to be made at `vault_path`.
#[tauri::command]
pub(crate) async fn sync_check_backup(vault_path: String, full_name: String) -> Result<(), String> {
    sync::check_backup_fits(&sync::sync_root()?, Path::new(&vault_path), &full_name).await
}

#[tauri::command(async)]
pub(crate) fn sync_get_conflict_versions(
    vault_path: String,
    path: String,
) -> Result<sync::conflicts::ConflictVersions, String> {
    open_vault_only(&vault_path)?;
    sync::conflicts::conflict_versions(&sync::sync_root()?, Path::new(&vault_path), &path)
}

#[tauri::command(async)]
pub(crate) fn sync_resolve_conflict(
    vault_path: String,
    path: String,
    choice: sync::conflicts::ConflictChoice,
) -> Result<sync::state::VaultSyncRecord, String> {
    open_vault_only(&vault_path)?;
    sync::conflicts::resolve_conflict(&sync::sync_root()?, Path::new(&vault_path), &path, choice)
}

#[tauri::command(async)]
pub(crate) fn sync_turn_off_backup(
    vault_path: String,
) -> Result<sync::state::VaultSyncRecord, String> {
    open_vault_only(&vault_path)?;
    sync::turn_off_backup(&sync::sync_root()?, Path::new(&vault_path))
}

/// Saves a version of the vault. The vault the app is leaving saves its last
/// one after the next vault opens, so any vault may, not only the open one.
#[tauri::command(async)]
pub(crate) fn sync_snapshot_vault(vault_path: String) -> Result<sync::VaultSnapshotResult, String> {
    vault_access::get().check_known_vault(Path::new(&vault_path))?;
    let sync_root = sync::sync_root()?;
    let snapshot = sync::snapshot_vault(&sync_root, Path::new(&vault_path))?;
    // Once a day, in the background: it waits for a sync to finish.
    std::thread::spawn(move || {
        if let Err(e) = sync::pack::pack_if_due(&sync_root, Path::new(&vault_path)) {
            eprintln!("[Netherstone] Couldn't pack the history: {}", e);
        }
    });
    Ok(snapshot)
}

/// Saves a version of the vault that keeps `previous`, the text the app last
/// saved to `file_path`, as well as the outside change now on disk.
#[tauri::command(async)]
pub(crate) fn sync_snapshot_outside_change(
    vault_path: String,
    file_path: String,
    previous: String,
) -> Result<sync::VaultSnapshotResult, String> {
    open_vault_only(&vault_path)?;
    in_open_vault(&file_path)?;
    sync::snapshot_outside_change(
        &sync::sync_root()?,
        Path::new(&vault_path),
        Path::new(&file_path),
        &previous,
    )
}

#[tauri::command(async)]
pub(crate) fn history_list_versions(
    vault_path: String,
    file_path: String,
) -> Result<sync::history::FileHistory, String> {
    open_vault_only(&vault_path)?;
    sync::history::list_versions(
        &sync::sync_root()?,
        Path::new(&vault_path),
        Path::new(&file_path),
    )
}

#[tauri::command(async)]
pub(crate) fn history_read_version(vault_path: String, blob: String) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    sync::history::read_version(&sync::sync_root()?, Path::new(&vault_path), &blob)
}

/// Puts an earlier version of a shard or drawing back, deleted ones too.
/// `expected_content` is the shard's text as the app last read or wrote it:
/// if the file changed outside the app since, nothing is restored.
#[tauri::command(async)]
pub(crate) fn history_restore(
    vault_path: String,
    file_path: String,
    blob: String,
    version_time: i64,
    expected_content: Option<String>,
) -> Result<sync::history::RestoreResult, String> {
    open_vault_only(&vault_path)?;
    vault_access::get().check_inside(Path::new(&file_path))?;
    let path = Path::new(&file_path);
    let is_drawing = vault::is_drawing_path(path);
    if !is_drawing && !vault::is_markdown_path(path) {
        return Err(format!("Not a shard or drawing: {}", file_path));
    }
    sync::history::restore(
        &sync::sync_root()?,
        Path::new(&vault_path),
        path,
        &blob,
        version_time,
        |content| {
            // A deleted file comes back where it was, folders and all.
            if let Some(folder) = path.parent().filter(|folder| !folder.exists()) {
                std::fs::create_dir_all(folder)
                    .map_err(|e| format!("Failed to create folder {}: {}", folder.display(), e))?;
            }
            if is_drawing {
                write_drawing_file(path, content, None)
            } else {
                write_markdown_file_if_unchanged(
                    Path::new(&vault_path),
                    &file_path,
                    content,
                    expected_content.as_deref(),
                )
                .map(|_| ())
            }
        },
    )
}
