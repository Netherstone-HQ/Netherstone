mod browser;
mod db;
mod export;
mod github;
mod import;
mod markdown_text;
mod shard_links;
mod splash;
mod sync;
mod updater;
mod vault;
mod watcher;
mod window_icon;

use serde::Serialize;
use std::path::Path;
use tauri_plugin_dialog::DialogExt;

const AST_CACHE_VERSION: i64 = 2;

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

fn resolve_ast_cache_version(cache_version: Option<i64>) -> i64 {
    cache_version.unwrap_or(AST_CACHE_VERSION)
}

fn hash_markdown_content(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

fn read_markdown_from_disk(file_path: &str) -> Result<String, String> {
    std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file {}: {}", file_path, e))
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
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|p| p.to_string())
}

/// Where new vaults go unless the user picks somewhere else: their
/// Documents folder.
#[tauri::command]
fn default_vault_location(app: tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    app.path()
        .document_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn create_vault(parent: String, name: String) -> Result<String, String> {
    vault::create_vault_folder(Path::new(&parent), &name)
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command(async)]
fn open_shard_dialog(
    app: tauri::AppHandle,
    default_directory: Option<String>,
) -> Option<vault::ShardDialogResult> {
    let mut dialog = app
        .dialog()
        .file()
        .add_filter("Shard", &["md"])
        .set_title("Open shard");

    if let Some(default_directory) = default_directory {
        let directory = std::path::Path::new(&default_directory);
        if directory.is_dir() {
            dialog = dialog.set_directory(directory);
        }
    }

    let file_path = dialog
        .blocking_pick_file()
        .and_then(|p| p.into_path().ok())?;

    let vault_path = file_path.parent()?.to_string_lossy().to_string();

    Some(vault::ShardDialogResult {
        file_path: file_path.to_string_lossy().to_string(),
        vault_path,
    })
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
        .map(|path| path.to_string_lossy().to_string())
        .collect::<Vec<_>>();

    Ok(selected_files)
}

#[tauri::command(async)]
fn import_shard(source_path: String, vault_path: String) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    let vault = std::path::Path::new(&vault_path);

    if !source.exists() {
        return Err(format!("Source shard does not exist: {}", source_path));
    }
    if !vault.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    vault::import_shard_to_vault(source, vault)
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

    picked
        .into_iter()
        .filter_map(|path| path.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

/// Lists the files in the picked files and folders.
#[tauri::command(async)]
fn list_import_sources(paths: Vec<String>) -> Vec<import::ImportSourceFile> {
    let paths: Vec<std::path::PathBuf> = paths.iter().map(std::path::PathBuf::from).collect();
    import::list_sources(&paths)
}

/// Reads a file being imported, as raw bytes.
#[tauri::command(async)]
fn read_import_file(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| format!("Could not read {}: {}", path, e))
}

/// Finds a free shard path in `target_dir` for each imported file.
#[tauri::command(async)]
fn reserve_import_paths(target_dir: String, relative_paths: Vec<String>) -> Result<Vec<String>, String> {
    import::reserve_shard_paths(Path::new(&target_dir), &relative_paths)
}

/// Writes an imported shard to a path `reserve_import_paths` gave out.
#[tauri::command(async)]
fn save_imported_shard(vault_path: String, file_path: String, content: String) -> Result<(), String> {
    import::prepare_new_shard(Path::new(&vault_path), Path::new(&file_path))?;
    write_markdown_file_and_sync_references(&file_path, &content)
}

#[tauri::command(async)]
fn persist_attachment_file(
    source_path: String,
    vault_path: String,
) -> Result<db::attachments::PersistedAttachment, String> {
    let source = std::path::Path::new(&source_path);
    let vault = std::path::Path::new(&vault_path);
    let conn = db::open_connection()?;

    db::attachments::persist_attachment_file(&conn, vault, source)
}

#[tauri::command(async)]
fn persist_attachment_bytes(
    file_name: String,
    bytes: Vec<u8>,
    vault_path: String,
) -> Result<db::attachments::PersistedAttachment, String> {
    let vault = std::path::Path::new(&vault_path);
    let conn = db::open_connection()?;

    db::attachments::persist_attachment_bytes(&conn, vault, &file_name, &bytes)
}

/// Re-checks the vault's attachments against its shards and the attachment
/// folder, repairs the database, and reports missing and unused files.
#[tauri::command(async)]
fn reconcile_attachments(vault_path: String) -> Result<db::attachments::AttachmentReport, String> {
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

/// Renames an attachment inside the attachment folder and moves its
/// database records. The caller rewrites links in shards.
#[tauri::command(async)]
fn rename_attachment(vault_path: String, from: String, to: String) -> Result<(), String> {
    let conn = db::open_connection()?;
    db::attachments::rename_attachment(&conn, Path::new(&vault_path), &from, &to)
}

/// Moves the requested unused attachments to the OS trash, after
/// re-checking that each is still unused and past the grace period.
#[tauri::command(async)]
fn clean_up_attachments(
    vault_path: String,
    asset_paths: Vec<String>,
) -> Result<db::attachments::CleanupResult, String> {
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
    let conn = db::open_connection()?;
    db::attachments::describe_missing_attachment(&conn, Path::new(&vault_path), &asset_path)
}

#[tauri::command(async)]
fn file_exists(file_path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&file_path).exists())
}

// ── Sync ─────────────────────────────────────────────────────────────────────

#[tauri::command(async)]
fn sync_get_vault_record(
    vault_path: String,
) -> Result<Option<sync::state::VaultSyncRecord>, String> {
    sync::state::find_record(&sync::sync_root()?, Path::new(&vault_path))
}

#[tauri::command(async)]
fn sync_plan_vault(vault_path: String) -> Result<sync::planner::SyncPlanSummary, String> {
    Ok(sync::planner::plan_vault(Path::new(&vault_path))?.summary())
}

#[tauri::command]
async fn sync_turn_on_backup(vault_path: String) -> Result<sync::SyncReport, String> {
    sync::turn_on_backup(sync::sync_root()?, vault_path.into()).await
}

#[tauri::command]
async fn sync_now(vault_path: String) -> Result<sync::SyncReport, String> {
    sync::sync_now(sync::sync_root()?, vault_path.into()).await
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
    sync::connect_backup(sync::sync_root()?, vault_path.into(), full_name, clone_url).await
}

#[tauri::command(async)]
fn sync_get_conflict_versions(
    vault_path: String,
    path: String,
) -> Result<sync::conflicts::ConflictVersions, String> {
    sync::conflicts::conflict_versions(&sync::sync_root()?, Path::new(&vault_path), &path)
}

#[tauri::command(async)]
fn sync_resolve_conflict(
    vault_path: String,
    path: String,
    choice: sync::conflicts::ConflictChoice,
) -> Result<sync::state::VaultSyncRecord, String> {
    sync::conflicts::resolve_conflict(&sync::sync_root()?, Path::new(&vault_path), &path, choice)
}

#[tauri::command(async)]
fn sync_turn_off_backup(vault_path: String) -> Result<sync::state::VaultSyncRecord, String> {
    sync::turn_off_backup(&sync::sync_root()?, Path::new(&vault_path))
}

#[tauri::command(async)]
fn sync_snapshot_vault(vault_path: String) -> Result<sync::VaultSnapshotResult, String> {
    sync::snapshot_vault(&sync::sync_root()?, Path::new(&vault_path))
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
fn scan_vault(vault_path: String) -> Result<Vec<vault::FileNode>, String> {
    let path = std::path::Path::new(&vault_path);

    if !path.exists() {
        return Err(format!("Path does not exist: {}", vault_path));
    }
    if !path.is_dir() {
        return Err(format!("Path is not a directory: {}", vault_path));
    }

    Ok(vault::scan_dir(path))
}

#[tauri::command(async)]
fn start_vault_watcher(app: tauri::AppHandle, vault_path: String) -> Result<(), String> {
    watcher::watch_vault(&app, &vault_path)
}

#[tauri::command(async)]
fn stop_vault_watcher(app: tauri::AppHandle) {
    watcher::unwatch_vault(&app);
}

#[tauri::command(async)]
fn read_markdown_file(file_path: String) -> Result<String, String> {
    read_markdown_from_disk(&file_path)
}

#[tauri::command(async)]
fn open_markdown_file(
    file_path: String,
    cache_version: Option<i64>,
) -> Result<OpenMarkdownFileResult, String> {
    let markdown = read_markdown_from_disk(&file_path)?;
    let content_hash = hash_markdown_content(&markdown);
    let expected_cache_version = resolve_ast_cache_version(cache_version);
    let conn = db::open_connection()?;

    eprintln!(
        "[Netherstone] AST cache lookup start path={} version={}",
        file_path, expected_cache_version
    );

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
            let _ = db::ast_cache::delete_ast_cache(&conn, &file_path);
            None
        }
    };

    if plate_value.is_none() {
        let _ = db::ast_cache::delete_ast_cache_for_version_mismatch(
            &conn,
            &file_path,
            expected_cache_version,
        );
    }

    let cache_hit = plate_value.is_some();

    eprintln!(
        "[Netherstone] AST cache {} path={} hash={} version={}",
        if cache_hit { "hit" } else { "miss" },
        file_path,
        content_hash,
        expected_cache_version
    );

    Ok(OpenMarkdownFileResult {
        file_path,
        markdown,
        content_hash,
        cache_hit,
        plate_value,
    })
}

#[tauri::command(async)]
fn upsert_ast_cache(
    file_path: String,
    markdown: String,
    cache_version: Option<i64>,
    plate_value: serde_json::Value,
) -> Result<(), String> {
    let content_hash = hash_markdown_content(&markdown);
    let expected_cache_version = resolve_ast_cache_version(cache_version);
    let conn = db::open_connection()?;

    eprintln!(
        "[Netherstone] AST cache upsert start path={} hash={} version={}",
        file_path, content_hash, expected_cache_version
    );

    match db::ast_cache::upsert_ast_cache(
        &conn,
        &file_path,
        &content_hash,
        expected_cache_version,
        &plate_value,
    ) {
        Ok(()) => {
            eprintln!(
                "[Netherstone] AST cache upsert success path={} hash={} version={}",
                file_path, content_hash, expected_cache_version
            );
            Ok(())
        }
        Err(error) => {
            eprintln!(
                "[Netherstone] AST cache upsert failed path={} hash={} version={} error={}",
                file_path, content_hash, expected_cache_version, error
            );
            Err(error)
        }
    }
}

#[tauri::command(async)]
fn delete_ast_cache(file_path: String) -> Result<bool, String> {
    let conn = db::open_connection()?;

    eprintln!("[Netherstone] AST cache delete start path={}", file_path);

    match db::ast_cache::delete_ast_cache(&conn, &file_path) {
        Ok(deleted) => {
            eprintln!(
                "[Netherstone] AST cache delete {} path={}",
                if deleted { "deleted" } else { "noop" },
                file_path
            );
            Ok(deleted)
        }
        Err(error) => {
            eprintln!(
                "[Netherstone] AST cache delete failed path={} error={}",
                file_path, error
            );
            Err(error)
        }
    }
}

#[tauri::command(async)]
fn rename_ast_cache(old_path: String, new_path: String) -> Result<bool, String> {
    let conn = db::open_connection()?;

    eprintln!(
        "[Netherstone] AST cache rename start old_path={} new_path={}",
        old_path, new_path
    );

    match db::ast_cache::rename_ast_cache(&conn, &old_path, &new_path) {
        Ok(renamed) => {
            eprintln!(
                "[Netherstone] AST cache rename {} old_path={} new_path={}",
                if renamed { "success" } else { "noop" },
                old_path,
                new_path
            );
            Ok(renamed)
        }
        Err(error) => {
            eprintln!(
                "[Netherstone] AST cache rename failed old_path={} new_path={} error={}",
                old_path, new_path, error
            );
            Err(error)
        }
    }
}

/// Serializes markdown writes. Commands run concurrently on the async runtime,
/// and overlapping saves of one file would race on the shared `.md.tmp` path.
static MARKDOWN_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn write_markdown_file_and_sync_references(file_path: &str, content: &str) -> Result<(), String> {
    let _write_guard = MARKDOWN_WRITE_LOCK
        .lock()
        .map_err(|e| format!("Failed to lock markdown writes: {}", e))?;
    let path = std::path::Path::new(file_path);
    let tmp_path = path.with_extension("md.tmp");

    // Write to temporary file first
    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temporary file: {}", e))?;

    // Atomically rename to target path
    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to save file {}: {}", file_path, e))?;

    match db::open_connection() {
        Ok(conn) => {
            if let Err(error) =
                db::attachments::sync_references_for_saved_markdown(&conn, file_path, content)
            {
                eprintln!(
                    "[Netherstone] Failed to sync attachment references after save {}: {}",
                    file_path, error
                );
            }
        }
        Err(error) => {
            eprintln!(
                "[Netherstone] Failed to open database while syncing attachment references {}: {}",
                file_path, error
            );
        }
    }

    Ok(())
}

/// Saves a shard. `record_writing` is set by saves of what you type in the
/// editor, which the Data page counts as writing on this device.
#[tauri::command(async)]
fn save_markdown_file(
    file_path: String,
    content: String,
    record_writing: Option<bool>,
) -> Result<(), String> {
    if record_writing == Some(true) {
        record_writing_before_save(&file_path, &content);
    }
    write_markdown_file_and_sync_references(&file_path, &content)
}

/// Logs the words written today, before the save replaces the words the shard
/// started the day with. A failure only costs the count.
fn record_writing_before_save(file_path: &str, content: &str) {
    let result = db::open_connection().and_then(|conn| {
        db::data::record_writing(&conn, &db::data::local_today(), file_path, content, || {
            std::fs::read_to_string(file_path).ok()
        })
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

    write_markdown_file_and_sync_references(&file_path, &content)
}

/// Serializes drawing writes for the same reason as `MARKDOWN_WRITE_LOCK`.
static DRAWING_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn ensure_drawing_path(path: &Path) -> Result<(), String> {
    if vault::is_drawing_path(path) {
        Ok(())
    } else {
        Err(format!("Not a drawing file: {}", path.display()))
    }
}

#[tauri::command(async)]
fn read_drawing_file(file_path: String) -> Result<String, String> {
    let path = Path::new(&file_path);
    ensure_drawing_path(path)?;

    std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read drawing {}: {}", file_path, e))
}

#[tauri::command(async)]
fn save_drawing_file(file_path: String, content: String) -> Result<(), String> {
    let path = Path::new(&file_path);
    ensure_drawing_path(path)?;

    let _write_guard = DRAWING_WRITE_LOCK
        .lock()
        .map_err(|e| format!("Failed to lock drawing writes: {}", e))?;
    let tmp_path = path.with_extension("excalidraw.tmp");

    std::fs::write(&tmp_path, content)
        .map_err(|e| format!("Failed to write temporary drawing file: {}", e))?;
    std::fs::rename(&tmp_path, path)
        .map_err(|e| format!("Failed to save drawing {}: {}", file_path, e))
}

/// Returns the shards in `vault_path` whose text contains any of `needles`.
/// Used to find the notes that embed an exported drawing.
#[tauri::command(async)]
fn find_shards_containing(vault_path: String, needles: Vec<String>) -> Result<Vec<String>, String> {
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    let needles: Vec<&str> = needles
        .iter()
        .map(String::as_str)
        .filter(|n| !n.is_empty())
        .collect();
    let mut paths = Vec::new();
    for node in &vault::scan_dir(vault) {
        collect_file_paths(node, &mut paths);
    }

    Ok(paths
        .into_iter()
        .filter(|path| {
            std::fs::read_to_string(path)
                .map(|content| needles.iter().any(|needle| content.contains(needle)))
                .unwrap_or(false)
        })
        .collect())
}

/// Creates the folder `name` inside `parent` and returns its path.
#[tauri::command(async)]
fn create_folder(parent: String, name: String) -> Result<String, String> {
    vault::create_folder(Path::new(&parent), &name).map(|p| p.to_string_lossy().into_owned())
}

/// Creates an empty drawing named `name` in `directory` and returns its path.
#[tauri::command(async)]
fn create_drawing_file(directory: String, name: String) -> Result<String, String> {
    let dir = Path::new(&directory);

    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }

    let path = vault::unique_drawing_path(dir, &name)?;
    std::fs::write(&path, vault::EMPTY_DRAWING)
        .map_err(|e| format!("Failed to create drawing {}: {}", path.display(), e))?;

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
    let conn = db::open_connection().map_err(|e| {
        eprintln!("[Netherstone] Couldn't open the search index: {}", e);
        SearchError::Unavailable
    })?;

    db::queries::search_files(&conn, &query, limit.unwrap_or(20)).map_err(|e| {
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
        match db::ast_cache::rename_ast_cache(&conn, &previous, &next) {
            Ok(renamed) => {
                eprintln!(
                    "[Netherstone] AST cache sync after file {} {} old_path={} new_path={}",
                    action,
                    if renamed { "success" } else { "noop" },
                    previous,
                    next
                );
            }
            Err(error) => {
                eprintln!(
                    "[Netherstone] Failed to update AST cache {} -> {}: {}",
                    previous, next, error
                );
            }
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

    let conn = match db::open_connection() {
        Ok(conn) => conn,
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
    match db::queries::files_linking_to_any(&conn, &shards) {
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
        if let Err(error) = write_markdown_file_and_sync_references(&file_new, &rewritten) {
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
        if let Err(error) = db::indexer::index_file(&conn, Path::new(&file_new)) {
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
    let old_file = std::path::Path::new(&old_path);

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

    let new_path_string = new_path.to_string_lossy().to_string();
    sync_caches_after_path_change(&old_path, &new_path, "rename");
    rewrite_links_after_path_change(&old_path, &new_path, "rename");

    Ok(new_path_string)
}

#[tauri::command(async)]
fn move_file(source_path: String, destination_dir: String) -> Result<String, String> {
    let source = std::path::Path::new(&source_path);
    let dest_dir = std::path::Path::new(&destination_dir);

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

    let new_path_string = new_path.to_string_lossy().to_string();
    sync_caches_after_path_change(&source_path, &new_path, "move");
    rewrite_links_after_path_change(&source_path, &new_path, "move");

    Ok(new_path_string)
}

#[tauri::command(async)]
fn delete_vault_path(target_path: String) -> Result<(), String> {
    let target = Path::new(&target_path);

    if !target.exists() {
        return Err(format!("Path does not exist: {}", target_path));
    }

    let markdown_paths = collect_markdown_file_paths(target)?;

    trash::delete(target)
        .map_err(|e| format!("Failed to move {} to the OS trash: {}", target_path, e))?;

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
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::queries::get_tagged_files(conn).map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
fn get_writing_log(vault_path: String) -> Result<db::data::WritingLog, String> {
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::data::get_writing_log(conn, &vault_path, &db::data::local_today())
    })
}

#[tauri::command(async)]
fn get_chart_shards() -> Result<Vec<db::data::ChartShard>, String> {
    let db = db::Database::new()?;

    db.with_connection(db::data::get_chart_shards)
}

#[tauri::command(async)]
fn get_broken_links() -> Result<Vec<db::data::BrokenLink>, String> {
    let db = db::Database::new()?;

    db.with_connection(db::data::get_broken_links)
}

#[tauri::command(async)]
fn get_backlinks(file_path: String) -> Result<Vec<db::queries::Backlink>, String> {
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::queries::get_backlinks(conn, &file_path).map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
fn get_file_metadata(file_path: String) -> Result<Option<db::queries::FileMetadata>, String> {
    let path = std::path::Path::new(&file_path);

    if !path.exists() {
        return Ok(None);
    }

    if !path.is_file() {
        return Err(format!("Path is not a file: {}", file_path));
    }

    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::indexer::index_file(conn, path).map_err(|_e| rusqlite::Error::InvalidQuery)?;
        db::queries::get_file_metadata(conn, &file_path).map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
fn index_vault(vault_path: String) -> Result<String, String> {
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

    eprintln!("[Netherstone] Starting vault indexing for: {}", vault_path);

    // Collect all file paths for pruning
    let mut all_paths = Vec::new();

    db.with_connection(|conn| {
        for node in &files {
            collect_file_paths(node, &mut all_paths);
        }

        // Index each file
        eprintln!(
            "[Netherstone] Found {} markdown files to process",
            all_paths.len()
        );

        for path_str in &all_paths {
            let path = std::path::Path::new(path_str);

            match db::indexer::needs_indexing(conn, path) {
                Ok(true) => {
                    eprintln!("[Netherstone] Indexing: {}", path_str);
                    match db::indexer::index_file(conn, path) {
                        Ok(_) => {
                            indexed_count += 1;
                            eprintln!("[Netherstone] Successfully indexed: {}", path_str);
                        }
                        Err(e) => {
                            eprintln!("[Netherstone] Failed to index {}: {}", path_str, e);
                            error_count += 1;
                        }
                    }
                }
                Ok(false) => {
                    eprintln!("[Netherstone] Skipping (already indexed): {}", path_str);
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

        // Prune deleted files
        match db::indexer::prune_deleted_files(conn, &all_paths) {
            Ok(deleted) => {
                if deleted > 0 {
                    eprintln!("Pruned {} deleted files from index", deleted);
                }
            }
            Err(e) => eprintln!("Failed to prune deleted files: {}", e),
        }

        // Prune stale AST cache rows for this vault only.
        match db::ast_cache::prune_stale_ast_cache_for_vault(conn, &vault_path, &all_paths) {
            Ok(deleted) => {
                if deleted > 0 {
                    eprintln!(
                        "[Netherstone] Pruned {} stale AST cache rows for vault {}",
                        deleted, vault_path
                    );
                }
            }
            Err(e) => eprintln!(
                "[Netherstone] Failed to prune stale AST cache rows for vault {}: {}",
                vault_path, e
            ),
        }

        Ok(())
    })?;

    let result = format!(
        "Indexed {} files, skipped {} unchanged, {} errors",
        indexed_count, skipped_count, error_count
    );
    eprintln!("[Netherstone] Indexing complete: {}", result);
    Ok(result)
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
            default_vault_location,
            create_vault,
            open_shard_dialog,
            open_media_files_dialog,
            import_shard,
            open_import_dialog,
            list_import_sources,
            read_import_file,
            reserve_import_paths,
            save_imported_shard,
            persist_attachment_file,
            persist_attachment_bytes,
            file_exists,
            scan_vault,
            github_get_account,
            github_token_storage,
            github_start_sign_in,
            github_finish_sign_in,
            github_cancel_sign_in,
            github_get_installation,
            github_sign_out,
            sync_get_vault_record,
            sync_plan_vault,
            sync_snapshot_vault,
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
            create_drawing_file,
            create_folder,
            reconcile_attachments,
            describe_missing_attachment,
            clean_up_attachments,
            rename_attachment,
            find_shards_containing,
            upsert_ast_cache,
            delete_ast_cache,
            rename_ast_cache,
            index_vault,
            search_files,
            get_tagged_files,
            get_writing_log,
            get_broken_links,
            get_chart_shards,
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
        let mut found =
            find_shards_containing(dir.to_string_lossy().into_owned(), needles).unwrap();
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

        let result = move_file(
            dir.join("Work").to_string_lossy().into_owned(),
            inner.to_string_lossy().into_owned(),
        );
        let still_there = inner.is_dir();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(result.is_err());
        assert!(still_there);
    }
}
