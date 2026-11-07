//! Import commands: picking, reading and saving what's imported.

use crate::attachments::copy_into_attachments;
use crate::shards::{paths::delete_path, write_shard};
use crate::vault_access::{self, in_open_vault, open_vault_only};
use crate::{db, import, locks, shard_links, vault};
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

/// Opens the native picker for files, or one folder, to import.
#[tauri::command(async)]
pub(crate) fn open_import_dialog(app: tauri::AppHandle, folder: bool) -> Vec<String> {
    let dialog = app.dialog().file().set_title("Import");
    let picked = if folder {
        dialog
            .blocking_pick_folder()
            .into_iter()
            .collect::<Vec<_>>()
    } else {
        dialog.blocking_pick_files().unwrap_or_default()
    };

    let picked: Vec<std::path::PathBuf> = picked
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .collect();
    import::picked().allow(&picked);
    picked
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Lists the files in the picked files and folders.
#[tauri::command(async)]
pub(crate) fn list_import_sources(
    paths: Vec<String>,
) -> Result<Vec<import::ImportSourceFile>, String> {
    let paths: Vec<std::path::PathBuf> = paths.iter().map(std::path::PathBuf::from).collect();
    for path in &paths {
        import::picked().check(path)?;
    }
    Ok(import::list_sources(&paths))
}

/// Reads a file being imported, as raw bytes.
#[tauri::command(async)]
pub(crate) fn read_import_file(path: String) -> Result<tauri::ipc::Response, String> {
    import::picked().check(Path::new(&path))?;
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {}: {}", path, e))
}

/// Reads up to `length` bytes of a file being imported from `offset`, as raw
/// bytes, so a big file such as a zip is never read whole.
#[tauri::command(async)]
pub(crate) fn read_import_file_range(
    path: String,
    offset: u64,
    length: u64,
) -> Result<tauri::ipc::Response, String> {
    use std::io::{Read, Seek, SeekFrom};
    import::picked().check(Path::new(&path))?;
    let read = || -> std::io::Result<Vec<u8>> {
        let mut file = std::fs::File::open(&path)?;
        file.seek(SeekFrom::Start(offset))?;
        let mut bytes = Vec::new();
        file.take(length).read_to_end(&mut bytes)?;
        Ok(bytes)
    };
    read()
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {}: {}", path, e))
}

/// Copies a file an imported shard uses into the vault's attachments.
#[tauri::command(async)]
pub(crate) fn import_attachment(
    app: tauri::AppHandle,
    path: String,
    vault_path: String,
) -> Result<db::attachments::PersistedAttachment, String> {
    import::picked().check(Path::new(&path))?;
    copy_into_attachments(&app, &path, &vault_path)
}

/// Takes an import back: moves the shards it made to the trash, like
/// deleting them, then the attachments it brought in that nothing else
/// links to. `since` is when the import started, in unix seconds.
#[tauri::command(async)]
pub(crate) fn undo_import(
    vault_path: String,
    target_dir: String,
    shard_paths: Vec<String>,
    asset_paths: Vec<String>,
    since: i64,
) -> Result<(), String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    let shards: Vec<std::path::PathBuf> =
        shard_paths.iter().map(std::path::PathBuf::from).collect();
    for shard in &shards {
        let inside = shard.starts_with(vault)
            && !shard
                .components()
                .any(|c| matches!(c, std::path::Component::ParentDir));
        if inside && vault::is_markdown_path(shard) && shard.exists() {
            delete_path(shard)?;
        }
    }
    if Path::new(&target_dir).starts_with(vault) {
        import::remove_empty_folders(Path::new(&target_dir), &shards);
    }

    let conn = db::open_connection()?;
    import::remove_new_attachments(&conn, vault, &asset_paths, since, |path| {
        trash::delete(path)
            .map_err(|e| format!("Failed to move {} to the OS trash: {}", path.display(), e))
    })?;
    Ok(())
}

/// Finds a free shard path in `target_dir` for each imported file.
#[tauri::command(async)]
pub(crate) fn reserve_import_paths(
    target_dir: String,
    relative_paths: Vec<String>,
) -> Result<Vec<String>, String> {
    in_open_vault(&target_dir)?;
    import::reserve_shard_paths(Path::new(&target_dir), &relative_paths)
}

/// Writes an imported shard to a path `reserve_import_paths` gave out, or the
/// next free one when that was taken since. Returns where it went.
#[tauri::command(async)]
pub(crate) fn save_imported_shard(
    vault_path: String,
    file_path: String,
    content: String,
) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    let writes = locks::vault_writes()?;
    let path = import::prepare_new_shard(Path::new(&vault_path), Path::new(&file_path))?;
    let path = path.to_string_lossy().into_owned();
    if let Err(error) = write_shard(&writes, Path::new(&vault_path), &path, &content) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    Ok(path)
}

/// Points the links in shards this import already saved at `new_path`,
/// where the shard reserved at `old_path` went instead.
#[tauri::command(async)]
pub(crate) fn fix_imported_links(
    shard_paths: Vec<String>,
    old_path: String,
    new_path: String,
) -> Result<(), String> {
    let moved = [shard_links::MovedShard {
        old: old_path,
        new: new_path,
    }];
    let vault = vault_access::get().open_vault()?;
    let writes = locks::vault_writes()?;
    for shard in &shard_paths {
        in_open_vault(shard)?;
        let markdown = std::fs::read_to_string(shard)
            .map_err(|e| format!("Failed to read {}: {}", shard, e))?;
        if let Some(fixed) = shard_links::rewrite_moved_links(&markdown, shard, shard, &moved) {
            write_shard(&writes, &vault, shard, &fixed)?;
        }
    }
    Ok(())
}
