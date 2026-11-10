//! Attachment commands: copying files in, the Gallery, cleanup, and files
//! shards link to.

use super::{cleanup, drawing_pictures, policy, report, store};
use crate::vault_access::{self, open_vault_only};
use crate::{asset_scope, copy_access, db, export, open_access, vault};
use std::path::Path;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

#[tauri::command(async)]
pub(crate) fn open_media_files_dialog(
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

/// Copies a file on this computer into the vault's attachments: one in the
/// vault, a picture, sound or video file, or one the user picked or agreed to
/// copy (see `copy_access`).
#[tauri::command(async)]
pub(crate) fn persist_attachment_file(
    app: tauri::AppHandle,
    source_path: String,
    vault_path: String,
) -> Result<store::PersistedAttachment, String> {
    copy_access::get().check(vault_access::get(), Path::new(&source_path))?;
    copy_into_attachments(&app, &source_path, &vault_path)
}

/// Asks the user, in a native dialog, before files outside the vault that
/// `persist_attachment_file` would refuse are copied in. Returns whether all
/// of `paths` may be copied now.
#[tauri::command(async)]
pub(crate) fn confirm_attachment_copies(app: tauri::AppHandle, paths: Vec<String>) -> bool {
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
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Copy".into(),
            "Cancel".into(),
        ))
        .blocking_show();
    if yes {
        copy_access::get().allow(&asking);
    }
    yes
}

pub(crate) fn copy_into_attachments(
    app: &tauri::AppHandle,
    source_path: &str,
    vault_path: &str,
) -> Result<store::PersistedAttachment, String> {
    open_vault_only(vault_path)?;
    let source = std::path::Path::new(source_path);
    let vault = std::path::Path::new(vault_path);
    let conn = db::open_connection()?;

    let attachment = store::persist_attachment_file(&conn, vault, source)?;
    // Through an attachment folder linked in from elsewhere, the new file
    // isn't covered by the vault's scope yet.
    asset_scope::show_linked_file(app, Path::new(&attachment.absolute_path));
    Ok(attachment)
}

/// Stores a file the app holds (pasted, dropped or made) as an attachment.
/// The body is the file; its name and the vault come URI-encoded in the
/// `x-file-name` and `x-vault-path` headers.
#[tauri::command(async)]
pub(crate) fn persist_attachment_bytes(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<store::PersistedAttachment, String> {
    let file_name =
        export::header(&request, "x-file-name").ok_or("The file is missing its name.")?;
    let vault_path =
        export::header(&request, "x-vault-path").ok_or("The file is missing its vault.")?;
    open_vault_only(&vault_path)?;
    let vault = std::path::Path::new(&vault_path);
    let conn = db::open_connection()?;

    let attachment =
        store::persist_attachment_bytes(&conn, vault, &file_name, export::raw_body(&request)?)?;
    asset_scope::show_linked_file(&app, Path::new(&attachment.absolute_path));
    Ok(attachment)
}

fn shard_paths(vault: &Path) -> Vec<String> {
    let mut paths = Vec::new();
    for node in &vault::scan_dir(vault) {
        vault::collect_file_paths(node, &mut paths);
    }
    paths
}

/// Moves the drawing pictures no shard in `vault` uses to the Trash.
pub(crate) fn remove_unused_drawing_pictures_in(vault: &Path) -> Result<Vec<String>, String> {
    let conn = db::open_connection()?;
    drawing_pictures::remove_unused_drawing_pictures(
        &conn,
        vault,
        || shard_paths(vault),
        crate::locks::vault_writes,
        |paths| trash::delete_all(paths).map_err(|e| e.to_string()),
    )
}

/// Moves the drawing pictures no shard uses any more to the Trash, such as
/// the pictures a new export just replaced.
#[tauri::command(async)]
pub(crate) fn remove_unused_drawing_pictures(vault_path: String) -> Result<Vec<String>, String> {
    open_vault_only(&vault_path)?;
    remove_unused_drawing_pictures_in(Path::new(&vault_path))
}

/// Re-checks the vault's attachments against its shards and the attachment
/// folder, repairs the database, and reports missing and unused files.
/// Drawing pictures no shard uses go to the Trash first.
#[tauri::command(async)]
pub(crate) fn reconcile_attachments(
    vault_path: String,
) -> Result<report::AttachmentReport, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    if let Err(error) = remove_unused_drawing_pictures_in(vault) {
        eprintln!(
            "[Netherstone] Failed to remove unused drawing pictures: {}",
            error
        );
    }
    let conn = db::open_connection()?;
    report::reconcile_vault_attachments(&conn, vault, &shard_paths(vault))
}

/// The open vault's attachments for the Gallery, newest added first.
#[tauri::command(async)]
pub(crate) fn list_attachments(
    vault_path: String,
) -> Result<Vec<db::gallery::GalleryFile>, String> {
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
pub(crate) fn gallery_thumbnail(
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
pub(crate) fn clean_up_attachments(
    vault_path: String,
    asset_paths: Vec<String>,
) -> Result<cleanup::CleanupResult, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    if !vault.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    let shards = shard_paths(vault);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;
    let conn = db::open_connection()?;
    cleanup::clean_up_vault_attachments(&conn, vault, &shards, &asset_paths, now, |path| {
        trash::delete(path).map_err(|e| e.to_string())
    })
}

/// The original name of a missing attachment and, when a file with the same
/// content is in the vault, where it is now.
#[tauri::command(async)]
pub(crate) fn describe_missing_attachment(
    vault_path: String,
    asset_path: String,
) -> Result<report::MissingAttachmentInfo, String> {
    open_vault_only(&vault_path)?;
    let conn = db::open_connection()?;
    report::describe_missing_attachment(&conn, Path::new(&vault_path), &asset_path)
}

/// Whether each vault attachment in `asset_paths` syncs, by today's rules, in
/// the same order. A path that isn't a vault attachment gets nothing.
#[tauri::command(async)]
pub(crate) fn attachment_sync_infos(
    vault_path: String,
    asset_paths: Vec<String>,
) -> Result<Vec<Option<policy::AttachmentSyncInfo>>, String> {
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);
    Ok(asset_paths
        .iter()
        .map(|asset_path| {
            policy::attachment_sync_info(vault, asset_path).unwrap_or_else(|e| {
                eprintln!("[Netherstone] Couldn't check whether a file syncs: {}", e);
                None
            })
        })
        .collect())
}

#[tauri::command(async)]
pub(crate) fn file_exists(file_path: String) -> Result<bool, String> {
    Ok(std::path::Path::new(&file_path).exists())
}

/// Opens a file a shard links to in the app the computer uses for it.
/// Programs, scripts and shortcuts are refused (see `open_access`).
#[tauri::command(async)]
pub(crate) fn open_file(path: String) -> Result<(), String> {
    open_access::check(Path::new(&path))?;
    tauri_plugin_opener::open_path(&path, None::<&str>)
        .map_err(|e| format!("Couldn't open {}: {}", path, e))
}

#[tauri::command(async)]
pub(crate) fn show_linked_file(app: tauri::AppHandle, file_path: String) -> bool {
    asset_scope::show_linked_file(&app, Path::new(&file_path))
}
