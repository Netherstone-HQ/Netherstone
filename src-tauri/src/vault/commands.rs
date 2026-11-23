//! Opening, making, scanning, watching and indexing the vault.

use crate::vault_access::{self, open_vault_only};
use crate::{asset_scope, assistant, db, gone_vaults, locks, sync, vault, watcher};
use std::path::Path;

#[tauri::command(async)]
pub(crate) fn open_vault_dialog(app: tauri::AppHandle) -> Option<String> {
    let picked = pick_folder(&app)?;
    vault_access::get().allow(&picked);
    Some(picked.to_string_lossy().into_owned())
}

#[cfg(desktop)]
fn pick_folder(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri_plugin_dialog::DialogExt;
    app.dialog().file().blocking_pick_folder()?.into_path().ok()
}

/// Phones have no folder picker: vaults live in the app's storage.
#[cfg(mobile)]
fn pick_folder(_app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    None
}

/// Makes `vault_path` the open vault, the only folder the other commands
/// touch. It must be a vault already, or a folder just picked or created.
/// It's kept in the list of vaults opened, newest first, which Settings
/// shows to pick the ones AI apps may use.
#[tauri::command(async)]
pub(crate) fn open_vault(vault_path: String) -> Result<(), String> {
    let vault = Path::new(&vault_path);
    vault_access::get().open(&sync::sync_root()?, vault)?;
    let kept = db::open_connection().and_then(|conn| {
        db::settings::record_opened_vault(&conn, vault, gone_vaults::drive_of(vault))
            .map_err(|e| e.to_string())
    });
    if let Err(error) = kept {
        eprintln!(
            "[Netherstone] Couldn't keep the vault in the vaults opened: {}",
            error
        );
    }
    Ok(())
}

/// Where new vaults go unless the user picks somewhere else: their
/// Documents folder.
#[tauri::command]
pub(crate) fn default_vault_location(app: tauri::AppHandle) -> Option<String> {
    documents_folder(&app).map(|p| p.to_string_lossy().into_owned())
}

fn documents_folder(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().document_dir().ok()
}

/// Makes the folder `name` in `parent` for a new vault. `parent` must be the
/// default location or a folder the user picked.
#[tauri::command(async)]
pub(crate) fn create_vault(
    app: tauri::AppHandle,
    parent: String,
    name: String,
) -> Result<String, String> {
    let parent = Path::new(&parent);
    vault_access::get().check_new_vault_parent(parent, documents_folder(&app).as_deref())?;
    let folder = vault::create_vault_folder(parent, &name)?;
    vault_access::get().allow(&folder);
    Ok(folder.to_string_lossy().into_owned())
}

/// Renames the open vault's folder to `name` and keeps it open there.
/// Returns its new path. Fails with a code for the app to word when the name
/// can't be used or the folder is in use.
#[tauri::command(async)]
pub(crate) fn rename_vault(
    app: tauri::AppHandle,
    vault_path: String,
    name: String,
) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    let old = Path::new(&vault_path);
    let new = vault::rename::renamed_path(old, &name)?;
    if new.as_os_str() == old.as_os_str() {
        return Ok(vault_path);
    }
    let sync_root = sync::sync_root()?;
    // Nothing syncs, saves a version or writes into the vault meanwhile.
    let _sync = locks::sync(&sync_root)?;
    let _history = locks::history(&sync_root)?;
    let _writes = locks::vault_writes()?;

    watcher::unwatch_vault(&app);
    if let Err(error) = vault::rename::rename_folder(old, &new) {
        if let Err(watch_error) = watcher::watch_vault(&app, &vault_path) {
            eprintln!(
                "[Netherstone] Couldn't watch the vault again: {}",
                watch_error
            );
        }
        return Err(error);
    }
    // Moves its sync record along, as for a vault moved outside the app.
    vault_access::get().open(&sync_root, &new)?;

    let followed = db::open_connection()
        .and_then(|conn| vault::rename::follow_in_database(&conn, old, &new))
        .and_then(|()| assistant::follow_vault_rename(old, &new));
    if let Err(error) = followed {
        eprintln!(
            "[Netherstone] Couldn't follow the rename of {}: {}",
            vault_path, error
        );
    }
    Ok(new.to_string_lossy().into_owned())
}

/// Free space, in bytes, on the disk the open vault is on.
#[tauri::command(async)]
pub(crate) fn vault_free_space(vault_path: String) -> Result<u64, String> {
    open_vault_only(&vault_path)?;
    fs4::available_space(&vault_path)
        .map_err(|e| format!("Could not read the free space for {}: {}", vault_path, e))
}

#[tauri::command(async)]
pub(crate) fn scan_vault(
    app: tauri::AppHandle,
    vault_path: String,
) -> Result<Vec<vault::FileNode>, String> {
    open_vault_only(&vault_path)?;
    let path = std::path::Path::new(&vault_path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", vault_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", vault_path));
    }

    asset_scope::allow_vault(&app, path);
    Ok(vault::scan_dir(path))
}

#[tauri::command(async)]
pub(crate) fn start_vault_watcher(app: tauri::AppHandle, vault_path: String) -> Result<(), String> {
    open_vault_only(&vault_path)?;
    asset_scope::allow_vault(&app, Path::new(&vault_path));
    watcher::watch_vault(&app, &vault_path)
}

#[tauri::command(async)]
pub(crate) fn stop_vault_watcher(app: tauri::AppHandle) {
    watcher::unwatch_vault(&app);
}

#[tauri::command(async)]
pub(crate) fn index_vault(vault_path: String) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    let conn = db::open_connection()?;
    let counts = db::indexer::index_vault(&conn, vault)?;

    if let Err(e) = db::data::start_writing_log(&conn, &vault_path, &db::data::local_today()) {
        eprintln!("[Netherstone] Failed to start the writing log: {}", e);
    }

    // Prune stale AST cache rows for this vault only.
    if let Err(e) =
        db::ast_cache::prune_stale_ast_cache_for_vault(&conn, &vault_path, &counts.paths)
    {
        eprintln!(
            "[Netherstone] Failed to prune stale AST cache rows for vault {}: {}",
            vault_path, e
        );
    }

    Ok(format!(
        "Indexed {} files, skipped {} unchanged, {} errors",
        counts.indexed, counts.skipped, counts.errors
    ))
}
