mod asset_scope;
mod browser;
mod copy_access;
mod db;
mod export;
mod github;
mod import;
mod locks;
mod markdown_text;
mod open_access;
mod shard_links;
mod splash;
mod sync;
mod updater;
mod vault;
mod vault_access;
mod watcher;
mod window_icon;

use serde::Serialize;
use std::path::Path;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

// Bump whenever the persisted Plate value shape changes, so older cached
// trees are dropped.
const AST_CACHE_VERSION: i64 = 3;

// Commands here are marked `async` so Tauri runs them on its async runtime.
// Plain sync commands run on the main thread, where file IO, SQLite and vault
// indexing freeze the window, and where the dialog plugin's blocking pickers
// must not be called.

#[derive(Debug, Serialize)]

struct OpenMarkdownFileResult {
    file_path: String,
    markdown: String,
    content_hash: String,
    cache_hit: bool,
    plate_value: Option<serde_json::Value>,
}

fn hash_markdown_content(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

fn read_markdown_from_disk(file_path: &str) -> Result<String, String> {
    std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file {}: {}", file_path, e))
}

/// Refuses `vault_path` unless it is the open vault.
fn open_vault_only(vault_path: &str) -> Result<(), String> {
    vault_access::get().check_vault(Path::new(vault_path))
}

/// Refuses `path` unless it is the open vault or inside it.
fn in_open_vault(path: &str) -> Result<(), String> {
    vault_access::get().check_path(Path::new(path))
}

fn ensure_markdown_path(path: &Path) -> Result<(), String> {
    if vault::is_markdown_path(path) {
        Ok(())
    } else {
        Err(format!("Not a shard: {}", path.display()))
    }
}

fn collect_markdown_file_paths(path: &Path) -> Result<Vec<String>, String> {
    let mut markdown_paths = Vec::new();

    if path.is_file() {
        if vault::is_markdown_path(path) {
            markdown_paths.push(path.to_string_lossy().to_string());
        }

        return Ok(markdown_paths);
    }

    if path.is_dir() {
        let entries = std::fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory {}: {}", path.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| {
                format!(
                    "Failed to read directory entry in {}: {}",
                    path.display(),
                    e
                )
            })?;
            let child_path = entry.path();
            markdown_paths.extend(collect_markdown_file_paths(&child_path)?);
        }
    }

    Ok(markdown_paths)
}

#[tauri::command(async)]
fn open_vault_dialog(app: tauri::AppHandle) -> Option<String> {
    let picked = app.dialog().file().blocking_pick_folder()?.into_path().ok()?;
    vault_access::get().allow(&picked);
    Some(picked.to_string_lossy().into_owned())
}

/// Makes `vault_path` the open vault, the only folder the other commands
/// touch. It must be a vault already, or a folder just picked or created.
#[tauri::command(async)]
fn open_vault(vault_path: String) -> Result<(), String> {
    vault_access::get().open(&sync::sync_root()?, Path::new(&vault_path))
}

/// Where new vaults go unless the user picks somewhere else: their
/// Documents folder.
#[tauri::command]
fn default_vault_location(app: tauri::AppHandle) -> Option<String> {
    documents_folder(&app).map(|p| p.to_string_lossy().into_owned())
}

fn documents_folder(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri::Manager;
    app.path().document_dir().ok()
}

/// Makes the folder `name` in `parent` for a new vault. `parent` must be the
/// default location or a folder the user picked.
#[tauri::command(async)]
fn create_vault(app: tauri::AppHandle, parent: String, name: String) -> Result<String, String> {
    let parent = Path::new(&parent);
    vault_access::get().check_new_vault_parent(parent, documents_folder(&app).as_deref())?;
    let folder = vault::create_vault_folder(parent, &name)?;
    vault_access::get().allow(&folder);
    Ok(folder.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn open_media_files_dialog(
    app: tauri::AppHandle,
    media_kind: Option<String>,
) -> Result<Vec<String>, String> {
    let kind = media_kind.unwrap_or_else(|| "file".to_string());
    let mut dialog = app.dialog().file();

    dialog = match kind.as_str() {
        "image" => dialog.add_filter(
            "Images",
            &[
                "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tif", "tiff",
            ],
        ),
        "video" => dialog.add_filter(
            "Videos",
            &["mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv"],
        ),
        "audio" => dialog.add_filter(
            "Audio",
            &["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "wma"],
        ),
        _ => dialog,
    };

    let selected_files = dialog
        .blocking_pick_files()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|file_path| file_path.into_path().ok())
        .collect::<Vec<_>>();

    // A picked file can stay where it is (relinking a moved file), so the
    // shard shows it from there.
    copy_access::get().allow(&selected_files);
    for path in &selected_files {
        asset_scope::show_linked_file(&app, path);
    }

    Ok(selected_files
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect())
}

/// Opens the native picker for files, or one folder, to import.
#[tauri::command(async)]
fn open_import_dialog(app: tauri::AppHandle, folder: bool) -> Vec<String> {
    let dialog = app.dialog().file().set_title("Import");
    let picked = if folder {
        dialog.blocking_pick_folder().into_iter().collect::<Vec<_>>()
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
fn list_import_sources(paths: Vec<String>) -> Result<Vec<import::ImportSourceFile>, String> {
    let paths: Vec<std::path::PathBuf> = paths.iter().map(std::path::PathBuf::from).collect();
    for path in &paths {
        import::picked().check(path)?;
    }
    Ok(import::list_sources(&paths))
}

/// Reads a file being imported, as raw bytes.
#[tauri::command(async)]
fn read_import_file(path: String) -> Result<tauri::ipc::Response, String> {
    import::picked().check(Path::new(&path))?;
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {}: {}", path, e))
}

/// Copies a file an imported shard uses into the vault's attachments.
#[tauri::command(async)]
fn import_attachment(
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
fn undo_import(
    vault_path: String,
    target_dir: String,
    shard_paths: Vec<String>,
    asset_paths: Vec<String>,
    since: i64,
) -> Result<(), String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    let shards: Vec<std::path::PathBuf> = shard_paths.iter().map(std::path::PathBuf::from).collect();
    for shard in &shards {
        let inside = shard.starts_with(vault) && !shard.components().any(|c| matches!(c, std::path::Component::ParentDir));
        if inside && vault::is_markdown_path(shard) && shard.exists() {
            delete_path(shard)?;
        }
    }
    if Path::new(&target_dir).starts_with(vault) {
        import::remove_empty_folders(Path::new(&target_dir), &shards);
    }

    let conn = db::open_connection()?;
    import::remove_new_attachments(&conn, vault, &asset_paths, since, |path| {
        trash::delete(path).map_err(|e| format!("Failed to move {} to the OS trash: {}", path.display(), e))
    })?;
    Ok(())
}

/// Finds a free shard path in `target_dir` for each imported file.
#[tauri::command(async)]
fn reserve_import_paths(target_dir: String, relative_paths: Vec<String>) -> Result<Vec<String>, String> {
    in_open_vault(&target_dir)?;
    import::reserve_shard_paths(Path::new(&target_dir), &relative_paths)
}

/// Writes an imported shard to a path `reserve_import_paths` gave out, or the
/// next free one when that was taken since. Returns where it went.
#[tauri::command(async)]
fn save_imported_shard(vault_path: String, file_path: String, content: String) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    let writes = locks::vault_writes()?;
    let path = import::prepare_new_shard(Path::new(&vault_path), Path::new(&file_path))?;
    let path = path.to_string_lossy().into_owned();
    if let Err(error) = write_shard(&writes, &path, &content) {
        let _ = std::fs::remove_file(&path);
        return Err(error);
    }
    Ok(path)
}

/// Points the links in shards this import already saved at `new_path`,
/// where the shard reserved at `old_path` went instead.
#[tauri::command(async)]
fn fix_imported_links(shard_paths: Vec<String>, old_path: String, new_path: String) -> Result<(), String> {
    let moved = [shard_links::MovedShard { old: old_path, new: new_path }];
    let writes = locks::vault_writes()?;
    for shard in &shard_paths {
        in_open_vault(shard)?;
        let markdown = std::fs::read_to_string(shard)
            .map_err(|e| format!("Failed to read {}: {}", shard, e))?;
        if let Some(fixed) = shard_links::rewrite_moved_links(&markdown, shard, shard, &moved) {
            write_shard(&writes, shard, &fixed)?;
        }
    }
    Ok(())
}

/// Copies a file on this computer into the vault's attachments: one in the
/// vault, a picture, sound or video file, or one the user picked or agreed to
/// copy (see `copy_access`).
#[tauri::command(async)]
fn persist_attachment_file(
    app: tauri::AppHandle,
    source_path: String,
    vault_path: String,
) -> Result<db::attachments::PersistedAttachment, String> {
    copy_access::get().check(vault_access::get(), Path::new(&source_path))?;
    copy_into_attachments(&app, &source_path, &vault_path)
}

/// Asks the user, in a native dialog, before files outside the vault that
/// `persist_attachment_file` would refuse are copied in. Returns whether all
/// of `paths` may be copied now.
#[tauri::command(async)]
fn confirm_attachment_copies(app: tauri::AppHandle, paths: Vec<String>) -> bool {
    let asking: Vec<std::path::PathBuf> = paths
        .iter()
        .map(std::path::PathBuf::from)
        .filter(|path| copy_access::get().needs_asking(vault_access::get(), path))
        .collect();
    if asking.is_empty() {
        return true;
    }
    let yes = app
        .dialog()
        .message(copy_access::question(&asking))
        .title("Copy into the vault")
        .buttons(MessageDialogButtons::OkCancelCustom("Copy".into(), "Cancel".into()))
        .blocking_show();
    if yes {
        copy_access::get().allow(&asking);
    }
    yes
}

fn copy_into_attachments(
    app: &tauri::AppHandle,
    source_path: &str,
    vault_path: &str,
) -> Result<db::attachments::PersistedAttachment, String> {
    open_vault_only(vault_path)?;
    let source = std::path::Path::new(source_path);
    let vault = std::path::Path::new(vault_path);
    let conn = db::open_connection()?;

    let attachment = db::attachments::persist_attachment_file(&conn, vault, source)?;
    // Through an attachment folder linked in from elsewhere, the new file
    // isn't covered by the vault's scope yet.
    asset_scope::show_linked_file(app, Path::new(&attachment.absolute_path));
    Ok(attachment)
}

/// Stores a file the app holds (pasted, dropped or made) as an attachment.
/// The body is the file; its name and the vault come URI-encoded in the
/// `x-file-name` and `x-vault-path` headers.
#[tauri::command(async)]
fn persist_attachment_bytes(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<db::attachments::PersistedAttachment, String> {
    let file_name = export::header(&request, "x-file-name").ok_or("The file is missing its name.")?;
    let vault_path = export::header(&request, "x-vault-path").ok_or("The file is missing its vault.")?;
    open_vault_only(&vault_path)?;
    let vault = std::path::Path::new(&vault_path);
    let conn = db::open_connection()?;

    let attachment = db::attachments::persist_attachment_bytes(
        &conn,
        vault,
        &file_name,
        export::raw_body(&request)?,
    )?;
    asset_scope::show_linked_file(&app, Path::new(&attachment.absolute_path));
    Ok(attachment)
}

/// Re-checks the vault's attachments against its shards and the attachment
/// folder, repairs the database, and reports missing and unused files.
#[tauri::command(async)]
fn reconcile_attachments(vault_path: String) -> Result<db::attachments::AttachmentReport, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    let mut shard_paths = Vec::new();
    for node in &vault::scan_dir(vault) {
        collect_file_paths(node, &mut shard_paths);
    }

    let conn = db::open_connection()?;
    db::attachments::reconcile_vault_attachments(&conn, vault, &shard_paths)
}

/// The open vault's attachments for the Gallery, newest added first.
#[tauri::command(async)]
fn list_attachments(vault_path: String) -> Result<Vec<db::gallery::GalleryFile>, String> {
    open_vault_only(&vault_path)?;
    let conn = db::open_connection()?;
    let files = db::gallery::list_vault_attachments(&conn, Path::new(&vault_path))?;
    // Thumbnails of pictures since removed or changed go, in the background.
    std::thread::spawn(move || {
        let vault = Path::new(&vault_path);
        if let Ok(folder) = db::gallery::thumbnail_folder(vault) {
            db::gallery::prune_thumbnails(&folder, vault);
        }
    });
    Ok(files)
}

/// The picture a Gallery tile shows for `asset_path`: a small copy, made the
/// first time it's asked for, or the picture itself when it's small already.
#[tauri::command(async)]
fn gallery_thumbnail(
    app: tauri::AppHandle,
    vault_path: String,
    asset_path: String,
) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    let folder = db::gallery::thumbnail_folder(vault)?;
    let shown = db::gallery::thumbnail(&folder, vault, &asset_path)?;
    if shown.starts_with(&folder) {
        asset_scope::allow_thumbnail(&app, &shown);
    }
    Ok(shown.to_string_lossy().into_owned())
}

/// Moves the requested unused attachments to the OS trash, after
/// re-checking that each is still unused and past the grace period.
#[tauri::command(async)]
fn clean_up_attachments(
    vault_path: String,
    asset_paths: Vec<String>,
) -> Result<db::attachments::CleanupResult, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    let mut shard_paths = Vec::new();
    for node in &vault::scan_dir(vault) {
        collect_file_paths(node, &mut shard_paths);
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let conn = db::open_connection()?;
    db::attachments::clean_up_vault_attachments(
        &conn,
        vault,
        &shard_paths,
        &asset_paths,
        now,
        |path| trash::delete(path).map_err(|e| e.to_string()),
    )
}

/// The original name of a missing attachment and, when a file with the same
/// content is in the vault, where it is now.
#[tauri::command(async)]
fn describe_missing_attachment(
    vault_path: String,
    asset_path: String,
) -> Result<db::attachments::MissingAttachmentInfo, String> {
    open_vault_only(&vault_path)?;
    let conn = db::open_connection()?;
    db::attachments::describe_missing_attachment(&conn, Path::new(&vault_path), &asset_path)
}

/// Whether each vault attachment in `asset_paths` syncs, by today's rules, in
/// the same order. A path that isn't a vault attachment gets nothing.
#[tauri::command(async)]
fn attachment_sync_infos(
    vault_path: String,
    asset_paths: Vec<String>,
) -> Result<Vec<Option<db::attachments::AttachmentSyncInfo>>, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    Ok(asset_paths
        .iter()
        .map(|asset_path| {
            db::attachments::attachment_sync_info(vault, asset_path).unwrap_or_else(|e| {
                eprintln!("[Netherstone] Couldn't check whether a file syncs: {}", e);
                None
            })
        })
        .collect())
}

#[tauri::command(async)]
fn file_exists(file_path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&file_path).exists())
}

/// Opens a file a shard links to in the app the computer uses for it.
/// Programs, scripts and shortcuts are refused (see `open_access`).
#[tauri::command(async)]
fn open_file(path: String) -> Result<(), String> {
    open_access::check(Path::new(&path))?;
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| format!("Couldn't open {}: {}", path, e))
}

#[tauri::command(async)]
fn show_linked_file(app: tauri::AppHandle, file_path: String) -> bool {
    asset_scope::show_linked_file(&app, Path::new(&file_path))
}

// ── Sync ─────────────────────────────────────────────────────────────────────

#[tauri::command(async)]
fn sync_get_vault_record(
    vault_path: String,
) -> Result<Option<sync::state::VaultSyncRecord>, String> {
    open_vault_only(&vault_path)?;
    sync::state::find_record(&sync::sync_root()?, Path::new(&vault_path))
}

#[tauri::command(async)]
fn find_nested_vault(folder: String) -> Result<Option<sync::state::NestedVault>, String> {
    Ok(sync::state::find_nested_vault(&sync::sync_root()?, Path::new(&folder)))
}

#[tauri::command(async)]
fn sync_plan_vault(vault_path: String) -> Result<sync::planner::SyncPlanSummary, String> {
    open_vault_only(&vault_path)?;
    Ok(sync::planner::plan_vault(Path::new(&vault_path))?.summary())
}

#[tauri::command]
async fn sync_turn_on_backup(vault_path: String) -> Result<sync::SyncReport, String> {
    open_vault_only(&vault_path)?;
    sync::turn_on_backup(sync::sync_root()?, vault_path.into()).await
}

#[tauri::command]
async fn sync_now(vault_path: String) -> Result<sync::SyncReport, String> {
    open_vault_only(&vault_path)?;
    sync::sync_now(sync::sync_root()?, vault_path.into()).await
}

/// Old versions of the open vault's attachments still in its history.
#[tauri::command(async)]
fn history_old_attachments(
    vault_path: String,
) -> Result<Vec<sync::space::OldAttachment>, String> {
    open_vault_only(&vault_path)?;
    sync::space::old_attachments(&sync::sync_root()?, Path::new(&vault_path))
}

/// Removes the picked old attachment versions from the vault's history.
#[tauri::command]
async fn history_free_up_space(
    vault_path: String,
    blobs: Vec<String>,
) -> Result<sync::space::Freed, String> {
    open_vault_only(&vault_path)?;
    sync::free_up_space(sync::sync_root()?, vault_path.into(), blobs).await
}

#[tauri::command]
async fn sync_list_backups() -> Result<Vec<github::repos::BackupSummary>, String> {
    sync::list_backups().await
}

#[tauri::command]
async fn sync_connect_backup(
    vault_path: String,
    full_name: String,
    clone_url: String,
) -> Result<sync::SyncReport, String> {
    open_vault_only(&vault_path)?;
    sync::connect_backup(sync::sync_root()?, vault_path.into(), full_name, clone_url).await
}

#[tauri::command(async)]
fn sync_get_conflict_versions(
    vault_path: String,
    path: String,
) -> Result<sync::conflicts::ConflictVersions, String> {
    open_vault_only(&vault_path)?;
    sync::conflicts::conflict_versions(&sync::sync_root()?, Path::new(&vault_path), &path)
}

#[tauri::command(async)]
fn sync_resolve_conflict(
    vault_path: String,
    path: String,
    choice: sync::conflicts::ConflictChoice,
) -> Result<sync::state::VaultSyncRecord, String> {
    open_vault_only(&vault_path)?;
    sync::conflicts::resolve_conflict(&sync::sync_root()?, Path::new(&vault_path), &path, choice)
}

#[tauri::command(async)]
fn sync_turn_off_backup(vault_path: String) -> Result<sync::state::VaultSyncRecord, String> {
    open_vault_only(&vault_path)?;
    sync::turn_off_backup(&sync::sync_root()?, Path::new(&vault_path))
}

/// Saves a version of the vault. The vault the app is leaving saves its last
/// one after the next vault opens, so any vault may, not only the open one.
#[tauri::command(async)]
fn sync_snapshot_vault(vault_path: String) -> Result<sync::VaultSnapshotResult, String> {
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
fn sync_snapshot_outside_change(
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

// ── History ──────────────────────────────────────────────────────────────────

#[tauri::command(async)]
fn history_list_versions(
    vault_path: String,
    file_path: String,
) -> Result<sync::history::FileHistory, String> {
    open_vault_only(&vault_path)?;
    sync::history::list_versions(&sync::sync_root()?, Path::new(&vault_path), Path::new(&file_path))
}

#[tauri::command(async)]
fn history_read_version(vault_path: String, blob: String) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    sync::history::read_version(&sync::sync_root()?, Path::new(&vault_path), &blob)
}

/// Puts an earlier version of a shard or drawing back, deleted ones too.
/// `expected_content` is the shard's text as the app last read or wrote it:
/// if the file changed outside the app since, nothing is restored.
#[tauri::command(async)]
fn history_restore(
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
                write_markdown_file_if_unchanged(&file_path, content, expected_content.as_deref())
                    .map(|_| ())
            }
        },
    )
}

// ── GitHub account ───────────────────────────────────────────────────────────

#[tauri::command(async)]
fn github_get_account() -> Result<Option<github::GitHubAccount>, String> {
    github::current_account()
}

#[tauri::command]
async fn github_start_sign_in() -> Result<github::SignInCode, String> {
    github::start_sign_in().await
}

#[tauri::command]
async fn github_finish_sign_in(
    remember: Option<bool>,
) -> Result<Option<github::GitHubAccount>, String> {
    github::finish_sign_in(remember.unwrap_or(true)).await
}

#[tauri::command(async)]
fn github_token_storage() -> Result<github::TokenStorageStatus, String> {
    github::token_storage_status()
}

#[tauri::command]
async fn github_get_installation() -> Result<github::app::InstallationStatus, String> {
    github::installation_status().await
}

#[tauri::command(async)]
fn github_cancel_sign_in() {
    github::cancel_sign_in()
}

#[tauri::command(async)]
fn github_sign_out() -> Result<(), String> {
    github::sign_out()
}

#[tauri::command(async)]
fn scan_vault(app: tauri::AppHandle, vault_path: String) -> Result<Vec<vault::FileNode>, String> {
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
fn start_vault_watcher(app: tauri::AppHandle, vault_path: String) -> Result<(), String> {
    open_vault_only(&vault_path)?;
    asset_scope::allow_vault(&app, Path::new(&vault_path));
    watcher::watch_vault(&app, &vault_path)
}

#[tauri::command(async)]
fn stop_vault_watcher(app: tauri::AppHandle) {
    watcher::unwatch_vault(&app);
}

#[tauri::command(async)]
fn read_markdown_file(file_path: String) -> Result<String, String> {
    in_open_vault(&file_path)?;
    ensure_markdown_path(Path::new(&file_path))?;
    read_markdown_from_disk(&file_path)
}

#[tauri::command(async)]
fn open_markdown_file(file_path: String) -> Result<OpenMarkdownFileResult, String> {
    in_open_vault(&file_path)?;
    ensure_markdown_path(Path::new(&file_path))?;
    let markdown = read_markdown_from_disk(&file_path)?;
    let content_hash = hash_markdown_content(&markdown);
    let expected_cache_version = AST_CACHE_VERSION;
    let conn = db::open_connection()?;

    let plate_value = match db::ast_cache::get_valid_ast_cache(
        &conn,
        &file_path,
        &content_hash,
        expected_cache_version,
    ) {
        Ok(value) => value,
        Err(error) => {
            eprintln!(
                "[Netherstone] AST cache read failed for {}: {}",
                file_path, error
            );
            None
        }
    };

    // A miss means the cached tree is for older text or an older version.
    if plate_value.is_none() {
        let _ = db::ast_cache::delete_ast_cache(&conn, &file_path);
    }

    Ok(OpenMarkdownFileResult {
        file_path,
        markdown,
        content_hash,
        cache_hit: plate_value.is_some(),
        plate_value,
    })
}

/// Caches a shard's editor tree. A shard's cache is written after the app
/// leaves it, maybe on another vault by then, so any vault may, not only the
/// open one.
#[tauri::command(async)]
fn upsert_ast_cache(
    vault_path: String,
    file_path: String,
    markdown: String,
    plate_value: serde_json::Value,
) -> Result<(), String> {
    vault_access::get().check_path_in_known_vault(Path::new(&vault_path), Path::new(&file_path))?;
    let content_hash = hash_markdown_content(&markdown);
    let expected_cache_version = AST_CACHE_VERSION;
    let conn = db::open_connection()?;

    db::ast_cache::upsert_ast_cache(
        &conn,
        &file_path,
        &content_hash,
        expected_cache_version,
        &plate_value,
    )
    .inspect_err(|error| {
        eprintln!(
            "[Netherstone] AST cache write failed path={} error={}",
            file_path, error
        )
    })
}

/// Writes a shard while `writes.lock` is held, then points its attachment
/// references at what it now links to.
fn write_shard(writes: &locks::VaultWrites, file_path: &str, content: &str) -> Result<(), String> {
    vault::write_atomically(writes, Path::new(file_path), content.as_bytes())?;

    let synced = vault_access::get().open_vault().and_then(|vault| {
        let conn = db::open_connection()?;
        db::attachments::sync_references_for_saved_markdown(&conn, &vault, file_path, content)
    });
    if let Err(error) = synced {
        eprintln!(
            "[Netherstone] Failed to sync attachment references after save {}: {}",
            file_path, error
        );
    }

    Ok(())
}

/// Writes a shard, but refuses when `expected` is given and the file now
/// holds something else. The check and the write happen under one lock, so
/// no other write lands in between. Returns the text the shard held before.
fn write_markdown_file_if_unchanged(
    file_path: &str,
    content: &str,
    expected: Option<&str>,
) -> Result<Option<String>, String> {
    let writes = locks::vault_writes()?;
    let previous = std::fs::read(file_path).ok();
    if is_changed(previous.as_deref(), expected) {
        return Err(CHANGED_ON_DISK.to_string());
    }
    write_shard(&writes, file_path, content)?;
    Ok(previous.and_then(|bytes| String::from_utf8(bytes).ok()))
}

/// What a save returns when the shard or drawing changed outside the app.
const CHANGED_ON_DISK: &str = "The shard changed on disk";

/// True when the file was there (`on_disk`) and doesn't hold `expected`.
fn is_changed(on_disk: Option<&[u8]>, expected: Option<&str>) -> bool {
    matches!((on_disk, expected), (Some(bytes), Some(expected)) if bytes != expected.as_bytes())
}

/// Saves a shard. `record_writing` is set by saves of what you type in the
/// editor, which the Data page counts as writing on this device.
/// `expected_content` is the text the app last read or wrote; if the file now
/// holds something else, it changed outside the app and the save is refused
/// rather than write over it.
#[tauri::command(async)]
fn save_markdown_file(
    file_path: String,
    content: String,
    record_writing: Option<bool>,
    expected_content: Option<String>,
) -> Result<(), String> {
    in_open_vault(&file_path)?;
    save_shard(&file_path, &content, record_writing == Some(true), expected_content.as_deref())
}

fn save_shard(
    file_path: &str,
    content: &str,
    record_writing: bool,
    expected: Option<&str>,
) -> Result<(), String> {
    ensure_markdown_path(Path::new(file_path))?;
    let previous = write_markdown_file_if_unchanged(file_path, content, expected)?;
    if record_writing {
        record_writing_after_save(file_path, content, previous);
    }
    Ok(())
}

/// Logs the words written today. The first save of the day also keeps the
/// words the shard started with, `previous`. A failure only costs the count.
fn record_writing_after_save(file_path: &str, content: &str, previous: Option<String>) {
    let result = db::open_connection().and_then(|conn| {
        db::data::record_writing(&conn, &db::data::local_today(), file_path, content, || previous)
            .map_err(|e| e.to_string())
    });
    if let Err(error) = result {
        eprintln!(
            "[Netherstone] Failed to log writing for {}: {}",
            file_path, error
        );
    }
}

#[tauri::command(async)]
fn append_markdown_to_file(file_path: String, markdown: String) -> Result<(), String> {
    in_open_vault(&file_path)?;
    ensure_markdown_path(Path::new(&file_path))?;
    // Read and written under one lock, so an edit in between isn't lost.
    let writes = locks::vault_writes()?;
    let mut content = read_markdown_from_disk(&file_path)?;

    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }

    if !content.is_empty() {
        content.push('\n');
    }

    content.push_str(&markdown);

    if !content.ends_with('\n') {
        content.push('\n');
    }

    write_shard(&writes, &file_path, &content)
}

fn ensure_drawing_path(path: &Path) -> Result<(), String> {
    if vault::is_drawing_path(path) {
        Ok(())
    } else {
        Err(format!("Not a drawing file: {}", path.display()))
    }
}

#[tauri::command(async)]
fn read_drawing_file(file_path: String) -> Result<String, String> {
    in_open_vault(&file_path)?;
    let path = Path::new(&file_path);
    ensure_drawing_path(path)?;

    std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read drawing {}: {}", file_path, e))
}

/// Saves a drawing. `expected_content` is the drawing as the app last read
/// or wrote it; if the file now holds something else, it changed outside the
/// app and the save is refused rather than write over it.
#[tauri::command(async)]
fn save_drawing_file(
    file_path: String,
    content: String,
    expected_content: Option<String>,
) -> Result<(), String> {
    in_open_vault(&file_path)?;
    write_drawing_file(Path::new(&file_path), &content, expected_content.as_deref())
}

/// Merges `ours` and `theirs`, two versions of the drawing `base`, shape by
/// shape. None when one of them isn't a drawing.
#[tauri::command(async)]
fn merge_drawings(
    base: String,
    ours: String,
    theirs: String,
) -> Option<sync::drawing_merge::MergedDrawing> {
    sync::drawing_merge::merge(&base, &ours, &theirs)
}

fn write_drawing_file(path: &Path, content: &str, expected: Option<&str>) -> Result<(), String> {
    ensure_drawing_path(path)?;

    let writes = locks::vault_writes()?;
    if is_changed(std::fs::read(path).ok().as_deref(), expected) {
        return Err(CHANGED_ON_DISK.to_string());
    }
    vault::write_atomically(&writes, path, content.as_bytes())
}

/// Returns the shards in `vault_path` whose text contains any of `needles`.
/// Used to find the notes that embed an exported drawing.
#[tauri::command(async)]
fn find_shards_containing(vault_path: String, needles: Vec<String>) -> Result<Vec<String>, String> {
    open_vault_only(&vault_path)?;
    Ok(shards_containing(Path::new(&vault_path), &needles))
}

fn shards_containing(vault: &Path, needles: &[String]) -> Vec<String> {
    let needles: Vec<&str> = needles
        .iter()
        .map(String::as_str)
        .filter(|n| !n.is_empty())
        .collect();
    let mut paths = Vec::new();
    for node in &vault::scan_dir(vault) {
        collect_file_paths(node, &mut paths);
    }

    paths
        .into_iter()
        .filter(|path| {
            std::fs::read_to_string(path)
                .map(|content| needles.iter().any(|needle| content.contains(needle)))
                .unwrap_or(false)
        })
        .collect()
}

/// A drawing a shard shows, with the files its pictures point at: `None`
/// where a picture has no source or it isn't a file in the vault.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrawingPictures {
    drawing_path: String,
    image_paths: Vec<Option<String>>,
}

/// Returns the drawings among `drawings` that have a picture missing or older
/// than the drawing, such as one changed while the app was closed. Drawings
/// that don't exist are left out.
#[tauri::command(async)]
fn stale_drawing_pictures(
    vault_path: String,
    drawings: Vec<DrawingPictures>,
) -> Result<Vec<String>, String> {
    open_vault_only(&vault_path)?;
    Ok(drawings
        .into_iter()
        .filter(|drawing| {
            let images: Vec<Option<&Path>> = drawing
                .image_paths
                .iter()
                .map(|path| {
                    path.as_deref()
                        .filter(|path| in_open_vault(path).is_ok())
                        .map(Path::new)
                })
                .collect();
            in_open_vault(&drawing.drawing_path).is_ok()
                && pictures_are_stale(Path::new(&drawing.drawing_path), &images)
        })
        .map(|drawing| drawing.drawing_path)
        .collect())
}

fn pictures_are_stale(drawing: &Path, images: &[Option<&Path>]) -> bool {
    fn modified(path: &Path) -> Option<std::time::SystemTime> {
        std::fs::metadata(path)
            .ok()
            .filter(|meta| meta.is_file())
            .and_then(|meta| meta.modified().ok())
    }

    let Some(drawn) = modified(drawing).filter(|_| vault::is_drawing_path(drawing)) else {
        return false;
    };
    images
        .iter()
        .any(|image| image.and_then(modified).is_none_or(|exported| exported < drawn))
}

/// Creates the folder `name` inside `parent` and returns its path.
#[tauri::command(async)]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    in_open_vault(&parent)?;
    let _writes = locks::vault_writes()?;
    vault::create_folder(Path::new(&parent), &name).map(|p| p.to_string_lossy().into_owned())
}

/// Creates an empty drawing named `name` in `directory` and returns its path.
#[tauri::command(async)]
fn create_drawing_file(directory: String, name: String) -> Result<String, String> {
    in_open_vault(&directory)?;
    let dir = Path::new(&directory);

    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }

    let writes = locks::vault_writes()?;
    let path = vault::unique_drawing_path(dir, &name)?;
    vault::write_atomically(&writes, &path, vault::EMPTY_DRAWING.as_bytes())?;

    Ok(path.to_string_lossy().to_string())
}

/// Why a search failed, so the search dialog can say what went wrong.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
enum SearchError {
    /// The search index couldn't be opened.
    Unavailable,
    /// The index opened, but the search itself failed.
    Failed,
}

#[tauri::command(async)]
fn search_files(
    query: String,
    limit: Option<usize>,
) -> Result<Vec<db::queries::SearchResult>, SearchError> {
    // With no vault open there is nothing to search.
    let Ok(vault) = vault_access::get().open_vault() else {
        return Ok(Vec::new());
    };
    let conn = db::open_connection().map_err(|e| {
        eprintln!("[Netherstone] Couldn't open the search index: {}", e);
        SearchError::Unavailable
    })?;

    db::queries::search_files(&conn, &vault, &query, limit.unwrap_or(20)).map_err(|e| {
        eprintln!("[Netherstone] Search failed: {}", e);
        SearchError::Failed
    })
}

/// The (old, new) path of every shard affected when `old_path` became
/// `new_path`: the shard itself, or each shard inside a folder.
fn moved_markdown_paths(old_path: &str, new_path: &Path) -> Vec<(String, String)> {
    if !new_path.is_dir() {
        return vec![(old_path.to_string(), new_path.to_string_lossy().to_string())];
    }

    let Ok(moved) = collect_markdown_file_paths(new_path) else {
        return Vec::new();
    };

    moved
        .into_iter()
        .filter_map(|moved_path| {
            let relative = Path::new(&moved_path).strip_prefix(new_path).ok()?;
            let previous = Path::new(old_path).join(relative);
            Some((previous.to_string_lossy().to_string(), moved_path))
        })
        .collect()
}

/// Points the AST cache and attachment references at the new paths after a
/// rename or move, so a folder takes the cached state of its shards along.
fn sync_caches_after_path_change(old_path: &str, new_path: &Path, action: &str) {
    let conn = match db::open_connection() {
        Ok(conn) => conn,
        Err(error) => {
            eprintln!(
                "[Netherstone] Failed to open database after {} {} -> {}: {}",
                action,
                old_path,
                new_path.display(),
                error
            );
            return;
        }
    };

    for (previous, next) in moved_markdown_paths(old_path, new_path) {
        if let Err(error) = db::ast_cache::rename_ast_cache(&conn, &previous, &next) {
            eprintln!(
                "[Netherstone] Failed to update AST cache {} -> {}: {}",
                previous, next, error
            );
        }

        if let Err(error) = db::attachments::rename_reference_file_path(&conn, &previous, &next) {
            eprintln!(
                "[Netherstone] Failed to update attachment references {} -> {}: {}",
                previous, next, error
            );
        }

        if let Err(error) = db::data::rename_writing_path(&conn, &previous, &next) {
            eprintln!(
                "[Netherstone] Failed to update the writing log {} -> {}: {}",
                previous, next, error
            );
        }
    }
}

/// Rewrites the links between shards after `old_path` became `new_path`:
/// the moved shards' own relative links, and the links to them in the
/// shards the index knows link there. Rewritten files are re-indexed and
/// their cached editor state dropped, since it names the old paths.
fn rewrite_links_after_path_change(old_path: &str, new_path: &Path, action: &str) {
    let moved: Vec<shard_links::MovedShard> = moved_markdown_paths(old_path, new_path)
        .into_iter()
        .filter(|(_, new)| vault::is_markdown_path(Path::new(new)))
        .map(|(old, new)| shard_links::MovedShard { old, new })
        .collect();
    if moved.is_empty() {
        return;
    }

    let opened = vault_access::get()
        .open_vault()
        .and_then(|vault| Ok((vault, db::open_connection()?)));
    let (vault, conn) = match opened {
        Ok(opened) => opened,
        Err(error) => {
            eprintln!(
                "[Netherstone] Failed to open database to rewrite links after {}: {}",
                action, error
            );
            return;
        }
    };

    let mut files: Vec<(String, String)> = moved
        .iter()
        .map(|m| (m.old.clone(), m.new.clone()))
        .collect();
    let shards: Vec<db::queries::LinkedShard> = moved
        .iter()
        .map(|m| db::queries::LinkedShard::new(&m.old))
        .collect();
    match db::queries::files_linking_to_any(&conn, &vault, &shards) {
        Ok(linking) => {
            for path in linking {
                let is_moved = moved.iter().any(|m| {
                    m.old
                        .replace('\\', "/")
                        .eq_ignore_ascii_case(&path.replace('\\', "/"))
                        || m.new
                            .replace('\\', "/")
                            .eq_ignore_ascii_case(&path.replace('\\', "/"))
                });
                if !is_moved {
                    files.push((path.clone(), path));
                }
            }
        }
        Err(error) => eprintln!(
            "[Netherstone] Failed to find shards linking to moved files after {}: {}",
            action, error
        ),
    }

    for (file_old, file_new) in files {
        // Read and written under one lock, so an edit in between isn't lost.
        let writes = match locks::vault_writes() {
            Ok(writes) => writes,
            Err(error) => {
                eprintln!(
                    "[Netherstone] Failed to rewrite links in {} after {}: {}",
                    file_new, action, error
                );
                continue;
            }
        };
        let content = match std::fs::read_to_string(&file_new) {
            Ok(content) => content,
            Err(error) => {
                eprintln!(
                    "[Netherstone] Failed to read {} to rewrite links after {}: {}",
                    file_new, action, error
                );
                continue;
            }
        };
        let Some(rewritten) =
            shard_links::rewrite_moved_links(&content, &file_old, &file_new, &moved)
        else {
            continue;
        };
        if let Err(error) = write_shard(&writes, &file_new, &rewritten) {
            eprintln!(
                "[Netherstone] Failed to rewrite links in {} after {}: {}",
                file_new, action, error
            );
            continue;
        }
        if let Err(error) = db::ast_cache::delete_ast_cache(&conn, &file_new) {
            eprintln!(
                "[Netherstone] Failed to drop the cached editor state of {}: {}",
                file_new, error
            );
        }
        if let Err(error) = db::indexer::index_file(&conn, &vault, Path::new(&file_new)) {
            eprintln!(
                "[Netherstone] Failed to re-index {} after rewriting links: {}",
                file_new, error
            );
        }
        eprintln!(
            "[Netherstone] Rewrote shard links in {} after {} {} -> {}",
            file_new,
            action,
            old_path,
            new_path.display()
        );
    }
}

#[tauri::command(async)]
fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    vault_access::get().check_inside(Path::new(&old_path))?;
    rename_path(&old_path, new_name)
}

fn rename_path(old_path: &str, new_name: String) -> Result<String, String> {
    let old_file = std::path::Path::new(old_path);

    let writes = locks::vault_writes()?;
    if !old_file.exists() {
        return Err(format!("File does not exist: {}", old_path));
    }

    let is_directory = old_file.is_dir();

    // Shards and drawings keep their extension when renamed without one.
    let kept_extension = if !old_file.is_file() {
        None
    } else if vault::is_markdown_path(old_file) {
        Some("md")
    } else if vault::is_drawing_path(old_file) {
        Some(vault::DRAWING_EXTENSION)
    } else {
        None
    };

    let resolved_new_name = match kept_extension {
        Some(ext) if !Path::new(&new_name).extension().is_some_and(|e| e == ext) => {
            format!("{}.{}", new_name, ext)
        }
        _ => new_name,
    };

    // Build new path in same directory
    let parent = old_file.parent().ok_or("Cannot get parent directory")?;
    let new_path = parent.join(&resolved_new_name);
    let mut parts = Path::new(&resolved_new_name).components();
    if !matches!((parts.next(), parts.next()), (Some(std::path::Component::Normal(_)), None)) {
        return Err(format!("'{}' can't be used as a name", resolved_new_name));
    }
    let old_path_normalized = old_file.to_string_lossy();
    let new_path_normalized = new_path.to_string_lossy();
    let is_case_only_rename = old_path_normalized.eq_ignore_ascii_case(&new_path_normalized)
        && old_path_normalized != new_path_normalized;

    if new_path.exists() && !is_case_only_rename {
        return Err(format!(
            "A {} with name '{}' already exists",
            if is_directory { "folder" } else { "file" },
            resolved_new_name
        ));
    }

    // Rename the file or directory
    std::fs::rename(&old_file, &new_path).map_err(|e| format!("Failed to rename file: {}", e))?;
    // Released first: rewriting links takes the lock for each shard.
    drop(writes);

    let new_path_string = new_path.to_string_lossy().to_string();
    sync_caches_after_path_change(old_path, &new_path, "rename");
    rewrite_links_after_path_change(old_path, &new_path, "rename");

    Ok(new_path_string)
}

#[tauri::command(async)]
fn move_file(source_path: String, destination_dir: String) -> Result<String, String> {
    vault_access::get().check_inside(Path::new(&source_path))?;
    in_open_vault(&destination_dir)?;
    move_path(&source_path, &destination_dir)
}

fn move_path(source_path: &str, destination_dir: &str) -> Result<String, String> {
    let source = std::path::Path::new(source_path);
    let dest_dir = std::path::Path::new(destination_dir);

    let writes = locks::vault_writes()?;
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }

    let kind = if source.is_dir() { "folder" } else { "file" };

    if !dest_dir.is_dir() {
        return Err(format!(
            "Destination is not a directory: {}",
            destination_dir
        ));
    }

    if source.is_dir() && dest_dir.starts_with(source) {
        return Err("A folder can't be moved into itself.".to_string());
    }

    let file_name = source.file_name().ok_or("Cannot get file name")?;

    let new_path = dest_dir.join(file_name);

    if new_path.exists() {
        return Err(format!(
            "A {} with name '{}' already exists in destination",
            kind,
            file_name.to_string_lossy()
        ));
    }

    std::fs::rename(&source, &new_path).map_err(|e| format!("Failed to move {}: {}", kind, e))?;
    // Released first: rewriting links takes the lock for each shard.
    drop(writes);

    let new_path_string = new_path.to_string_lossy().to_string();
    sync_caches_after_path_change(source_path, &new_path, "move");
    rewrite_links_after_path_change(source_path, &new_path, "move");

    Ok(new_path_string)
}

#[tauri::command(async)]
fn delete_vault_path(target_path: String) -> Result<(), String> {
    vault_access::get().check_inside(Path::new(&target_path))?;
    delete_path(Path::new(&target_path))
}

/// Moves a shard, drawing or folder to the OS trash and forgets the shards'
/// cached state.
fn delete_path(target: &Path) -> Result<(), String> {
    let target_path = target.to_string_lossy();
    let writes = locks::vault_writes()?;
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target_path));
    }

    let markdown_paths = collect_markdown_file_paths(target)?;

    trash::delete(target)
        .map_err(|e| format!("Failed to move {} to the OS trash: {}", target_path, e))?;
    drop(writes);

    match db::open_connection() {
        Ok(conn) => {
            for markdown_path in markdown_paths {
                match db::ast_cache::delete_ast_cache(&conn, &markdown_path) {
                    Ok(deleted) => {
                        eprintln!(
                            "[Netherstone] AST cache sync after delete {} path={}",
                            if deleted { "deleted" } else { "noop" },
                            markdown_path
                        );
                    }
                    Err(error) => {
                        eprintln!(
                            "[Netherstone] Failed to delete AST cache for {}: {}",
                            markdown_path, error
                        );
                    }
                }

                if let Err(error) =
                    db::attachments::remove_references_for_markdown_file(&conn, &markdown_path)
                {
                    eprintln!(
                        "[Netherstone] Failed to remove attachment references for {}: {}",
                        markdown_path, error
                    );
                }
            }
        }
        Err(error) => {
            eprintln!(
                "[Netherstone] Failed to open database while deleting {}: {}",
                target_path, error
            );
        }
    }

    Ok(())
}

#[tauri::command(async)]
fn get_tagged_files() -> Result<Vec<db::queries::TaggedFile>, String> {
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::queries::get_tagged_files(conn, &vault).map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
fn get_writing_log(vault_path: String) -> Result<db::data::WritingLog, String> {
    open_vault_only(&vault_path)?;
    let today = db::data::local_today();
    // Without its history, the page still shows what this device counted.
    let history = sync::sync_root()
        .and_then(|sync_root| {
            sync::writing::writing_history(
                &sync_root,
                Path::new(&vault_path),
                &db::data::first_log_day(&today),
            )
        })
        .unwrap_or_else(|error| {
            eprintln!(
                "[Netherstone] Couldn't read writing from history: {}",
                error
            );
            None
        });
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::data::get_writing_log(conn, &vault_path, &today, history.as_ref())
    })
}

#[tauri::command(async)]
fn get_charts() -> Result<Vec<db::data::ShardChart>, String> {
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| db::data::get_charts(conn, &vault))
}

#[tauri::command(async)]
fn get_broken_links() -> Result<Vec<db::data::BrokenLink>, String> {
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| db::data::get_broken_links(conn, &vault))
}

#[tauri::command(async)]
fn get_backlinks(file_path: String) -> Result<Vec<db::queries::Backlink>, String> {
    in_open_vault(&file_path)?;
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::queries::get_backlinks(conn, &vault, &file_path)
            .map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
fn get_file_metadata(file_path: String) -> Result<Option<db::queries::FileMetadata>, String> {
    in_open_vault(&file_path)?;
    let path = std::path::Path::new(&file_path);

    if !path.exists() {
        return Ok(None);
    }

    if !path.is_file() {
        return Err(format!("Path is not a file: {}", file_path));
    }

    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::indexer::index_file(conn, &vault, path).map_err(|_e| rusqlite::Error::InvalidQuery)?;
        db::queries::get_file_metadata(conn, &file_path).map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
fn index_vault(vault_path: String) -> Result<String, String> {
    open_vault_only(&vault_path)?;
    let vault = std::path::Path::new(&vault_path);

    if !vault.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    // Open database connection
    let db = db::Database::new()?;

    // Scan all markdown files in the vault
    let files = vault::scan_dir(vault);
    let mut indexed_count = 0;
    let mut skipped_count = 0;
    let mut error_count = 0;

    // Collect all file paths for pruning
    let mut all_paths = Vec::new();

    db.with_connection(|conn| {
        for node in &files {
            collect_file_paths(node, &mut all_paths);
        }

        // Index each file
        for path_str in &all_paths {
            let path = std::path::Path::new(path_str);

            match db::indexer::needs_indexing(conn, vault, path) {
                Ok(true) => {
                    match db::indexer::index_file(conn, vault, path) {
                        Ok(_) => {
                            indexed_count += 1;
                        }
                        Err(e) => {
                            eprintln!("[Netherstone] Failed to index {}: {}", path_str, e);
                            error_count += 1;
                        }
                    }
                }
                Ok(false) => {
                    skipped_count += 1;
                }
                Err(e) => {
                    eprintln!("[Netherstone] Failed to check {}: {}", path_str, e);
                    error_count += 1;
                }
            }
        }

        if let Err(e) = db::data::start_writing_log(conn, &vault_path, &db::data::local_today()) {
            eprintln!("[Netherstone] Failed to start the writing log: {}", e);
        }

        // Prune this vault's deleted files only.
        if let Err(e) = db::indexer::prune_deleted_files(conn, vault, &all_paths) {
            eprintln!("Failed to prune deleted files: {}", e);
        }

        // Prune stale AST cache rows for this vault only.
        if let Err(e) = db::ast_cache::prune_stale_ast_cache_for_vault(conn, &vault_path, &all_paths) {
            eprintln!(
                "[Netherstone] Failed to prune stale AST cache rows for vault {}: {}",
                vault_path, e
            );
        }

        Ok(())
    })?;

    Ok(format!(
        "Indexed {} files, skipped {} unchanged, {} errors",
        indexed_count, skipped_count, error_count
    ))
}

fn collect_file_paths(node: &vault::FileNode, paths: &mut Vec<String>) {
    match node.kind {
        vault::FileNodeKind::File => {
            // Drawings appear in the tree but are not indexed as markdown.
            if vault::is_markdown_path(Path::new(&node.path)) {
                paths.push(node.path.clone());
            }
        }
        vault::FileNodeKind::Directory => {
            if let Some(children) = &node.children {
                for child in children {
                    collect_file_paths(child, paths);
                }
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(browser::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(export::pdf::SCHEME, export::pdf::serve)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(browser::BrowserState::default())
        .manage(watcher::WatcherState::new())
        .manage(updater::PendingUpdate::default())
        .setup(|app| {
            for window in tauri::Manager::windows(app).values() {
                window_icon::apply(window);
            }
            splash::show_main_window_eventually(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::ScaleFactorChanged { .. } = event {
                window_icon::apply(window);
            }
        })
        .invoke_handler(tauri::generate_handler![
            splash::show_main_window,
            updater::updater_check,
            updater::updater_install,
            browser::browser_reset_state,
            browser::browser_get_state,
            browser::browser_navigate,
            browser::browser_reload,
            browser::browser_stop_loading,
            browser::browser_go_back,
            browser::browser_go_forward,
            browser::browser_set_bounds,
            browser::browser_set_visible,
            open_vault_dialog,
            open_vault,
            default_vault_location,
            create_vault,
            open_media_files_dialog,
            open_import_dialog,
            list_import_sources,
            read_import_file,
            undo_import,
            reserve_import_paths,
            save_imported_shard,
            persist_attachment_file,
            confirm_attachment_copies,
            persist_attachment_bytes,
            import_attachment,
            fix_imported_links,
            file_exists,
            show_linked_file,
            open_file,
            scan_vault,
            github_get_account,
            github_token_storage,
            github_start_sign_in,
            github_finish_sign_in,
            github_cancel_sign_in,
            github_get_installation,
            github_sign_out,
            sync_get_vault_record,
            find_nested_vault,
            sync_plan_vault,
            sync_snapshot_vault,
            sync_snapshot_outside_change,
            history_list_versions,
            history_read_version,
            history_restore,
            history_old_attachments,
            history_free_up_space,
            sync_turn_on_backup,
            sync_now,
            sync_list_backups,
            sync_connect_backup,
            sync_get_conflict_versions,
            sync_resolve_conflict,
            sync_turn_off_backup,
            start_vault_watcher,
            stop_vault_watcher,
            read_markdown_file,
            open_markdown_file,
            save_markdown_file,
            append_markdown_to_file,
            read_drawing_file,
            save_drawing_file,
            merge_drawings,
            create_drawing_file,
            create_folder,
            reconcile_attachments,
            list_attachments,
            gallery_thumbnail,
            describe_missing_attachment,
            attachment_sync_infos,
            clean_up_attachments,
            find_shards_containing,
            stale_drawing_pictures,
            upsert_ast_cache,
            index_vault,
            search_files,
            get_tagged_files,
            get_writing_log,
            get_broken_links,
            get_charts,
            get_file_metadata,
            get_backlinks,
            rename_file,
            move_file,
            delete_vault_path,
            export::choose_export_path,
            export::write_export_file,
            export::read_export_asset,
            export::fetch_export_asset,
            export::export_pdf
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn save_refuses_to_write_over_an_outside_change() {
        let dir = std::env::temp_dir().join(format!("netherstone-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shard = dir.join("Note.md");
        let path = shard.to_string_lossy().into_owned();
        std::fs::write(&shard, "opened").unwrap();

        save_shard(&path, "typed", false, Some("opened")).unwrap();
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "typed");

        std::fs::write(&shard, "outside").unwrap();
        assert_eq!(
            save_shard(&path, "typed more", false, Some("typed")),
            Err(CHANGED_ON_DISK.to_string())
        );
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "outside");

        // Other saves, and a shard that was deleted, are written as before.
        save_shard(&path, "renamed", false, None).unwrap();
        std::fs::remove_file(&shard).unwrap();
        save_shard(&path, "again", false, Some("renamed")).unwrap();
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "again");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn drawing_save_refuses_to_write_over_an_outside_change() {
        let dir = std::env::temp_dir().join(format!("netherstone-drawing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let drawing = dir.join("Plan.excalidraw");
        std::fs::write(&drawing, "opened").unwrap();

        write_drawing_file(&drawing, "drawn", Some("opened")).unwrap();
        std::fs::write(&drawing, "outside").unwrap();
        assert_eq!(
            write_drawing_file(&drawing, "drawn more", Some("drawn")),
            Err(CHANGED_ON_DISK.to_string())
        );
        assert_eq!(std::fs::read_to_string(&drawing).unwrap(), "outside");

        write_drawing_file(&drawing, "merged", Some("outside")).unwrap();
        assert_eq!(std::fs::read_to_string(&drawing).unwrap(), "merged");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn pictures_are_stale_when_missing_or_older_than_the_drawing() {
        let dir = std::env::temp_dir().join(format!("netherstone-stale-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let at = |name: &str, seconds: u64| {
            let path = dir.join(name);
            std::fs::write(&path, name).unwrap();
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))
                .unwrap();
            path
        };
        let drawing = at("Plan.excalidraw", 20);
        let older = at("old.png", 10);
        let same = at("same.png", 20);
        let newer = at("new.png", 30);
        let missing = dir.join("missing.png");
        let not_a_drawing = at("Plan.md", 20);

        let stale = |images: &[Option<&Path>]| pictures_are_stale(&drawing, images);
        assert!(!stale(&[Some(&same), Some(&newer)]));
        assert!(stale(&[Some(&newer), Some(&older)]));
        assert!(stale(&[Some(&newer), Some(&missing)]));
        assert!(stale(&[Some(&newer), None]));
        assert!(!pictures_are_stale(&dir.join("Gone.excalidraw"), &[None]));
        assert!(!pictures_are_stale(&not_a_drawing, &[None]));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn find_shards_containing_matches_any_needle_in_markdown_only() {
        let dir = std::env::temp_dir().join(format!("netherstone-find-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(
            dir.join("a.md"),
            r#"<img data-excalidraw="d/F &amp; co.excalidraw" />"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("sub/b.md"),
            r#"<img data-excalidraw="d/F & co.excalidraw" />"#,
        )
        .unwrap();
        std::fs::write(dir.join("c.md"), "no drawings").unwrap();
        std::fs::write(dir.join("d.excalidraw"), r#"data-excalidraw="d/F & co"#).unwrap();

        let needles = vec![
            r#"data-excalidraw="d/F & co"#.to_string(),
            r#"data-excalidraw="d/F &amp; co"#.to_string(),
            String::new(),
        ];
        let mut found = shards_containing(&dir, &needles);
        found.sort();
        std::fs::remove_dir_all(&dir).unwrap();

        let names: Vec<_> = found
            .iter()
            .map(|path| {
                Path::new(path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, ["a.md", "b.md"]);
    }
    #[test]
    fn moved_markdown_paths_maps_every_shard_in_a_folder() {
        let dir = std::env::temp_dir().join(format!("netherstone-moved-{}", std::process::id()));
        let moved = dir.join("Archive").join("Work");
        std::fs::create_dir_all(moved.join("2026")).unwrap();
        std::fs::write(moved.join("Plan.md"), "").unwrap();
        std::fs::write(moved.join("2026").join("Notes.md"), "").unwrap();
        std::fs::write(moved.join("Sketch.excalidraw"), "").unwrap();

        let old_root = dir.join("Work");
        let mut pairs = moved_markdown_paths(&old_root.to_string_lossy(), &moved);
        pairs.sort();
        std::fs::remove_dir_all(&dir).unwrap();

        let expected = |relative: &[&str]| {
            let from = relative.iter().fold(old_root.clone(), |p, part| p.join(part));
            let to = relative.iter().fold(moved.clone(), |p, part| p.join(part));
            (from.to_string_lossy().to_string(), to.to_string_lossy().to_string())
        };
        let mut wanted = vec![expected(&["2026", "Notes.md"]), expected(&["Plan.md"])];
        wanted.sort();
        assert_eq!(pairs, wanted);
    }

    #[test]
    fn move_file_refuses_to_move_a_folder_into_itself() {
        let dir = std::env::temp_dir().join(format!("netherstone-into-{}", std::process::id()));
        let inner = dir.join("Work").join("Inner");
        std::fs::create_dir_all(&inner).unwrap();

        let result = move_path(
            &dir.join("Work").to_string_lossy(),
            &inner.to_string_lossy(),
        );
        let still_there = inner.is_dir();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(result.is_err());
        assert!(still_there);
    }

    #[test]
    fn a_save_returns_the_text_it_replaced_and_only_writes_shards() {
        let dir = std::env::temp_dir().join(format!("netherstone-previous-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shard = dir.join("Note.md").to_string_lossy().into_owned();

        assert_eq!(write_markdown_file_if_unchanged(&shard, "first", None), Ok(None));
        assert_eq!(
            write_markdown_file_if_unchanged(&shard, "second", Some("first")),
            Ok(Some("first".to_string()))
        );
        let script = dir.join("run.sh").to_string_lossy().into_owned();
        let refused = save_shard(&script, "echo hi", false, None);
        let script_written = Path::new(&script).exists();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(refused.is_err());
        assert!(!script_written);
    }

    #[test]
    fn rename_keeps_the_new_name_in_the_same_folder() {
        let dir = std::env::temp_dir().join(format!("netherstone-rename-{}", std::process::id()));
        let folder = dir.join("Work");
        std::fs::create_dir_all(&folder).unwrap();
        let shard = folder.join("Plan.md");
        std::fs::write(&shard, "plan").unwrap();
        let shard_path = shard.to_string_lossy().into_owned();

        let escapes = [
            rename_path(&shard_path, "../Plan".into()),
            rename_path(&shard_path, "Sub/Plan".into()),
            rename_path(&folder.to_string_lossy(), "..".into()),
        ];
        let renamed = rename_path(&shard_path, "Roadmap".into()).unwrap();
        let moved_out = dir.join("Plan.md").exists();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(escapes.iter().all(Result::is_err));
        assert!(!moved_out);
        assert_eq!(Path::new(&renamed), folder.join("Roadmap.md"));
    }
}
