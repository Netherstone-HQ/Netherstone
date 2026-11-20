//! The voice note being recorded. Its bytes go to a temporary file as they
//! arrive, so a crash or a failed write loses nothing, and Save stores that
//! file as an attachment of the vault.

use crate::attachments::policy::SYNC_SOFT_LIMIT_BYTES;
use crate::attachments::store::{self, PersistedAttachment};
use crate::vault_access::open_vault_only;
use crate::{asset_scope, db, export};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const FOLDER_NAME: &str = "voice-notes";

struct Recording {
    path: PathBuf,
    file: File,
}

static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Started {
    sync_limit_bytes: u64,
}

/// Why a recording couldn't be written or saved.
#[derive(Debug, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteError {
    DiskFull,
    Failed { message: String },
}

impl From<std::io::Error> for WriteError {
    fn from(error: std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::StorageFull {
            WriteError::DiskFull
        } else {
            WriteError::Failed {
                message: error.to_string(),
            }
        }
    }
}

impl From<String> for WriteError {
    fn from(message: String) -> Self {
        WriteError::Failed { message }
    }
}

fn folder() -> Result<PathBuf, WriteError> {
    let db_path = db::get_db_path()?;
    let data = db_path.parent().ok_or_else(|| WriteError::Failed {
        message: "The app's data folder is missing.".into(),
    })?;
    Ok(data.join(FOLDER_NAME))
}

fn begin_in(folder: &Path) -> Result<Recording, WriteError> {
    std::fs::create_dir_all(folder)?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_millis())
        .unwrap_or_default();
    // Two recordings started in the same millisecond take the next number.
    let mut attempt = 0u32;
    loop {
        let path = folder.join(format!("recording-{stamp}-{attempt}.webm"));
        match File::options().create_new(true).append(true).open(&path) {
            Ok(file) => return Ok(Recording { path, file }),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => attempt += 1,
            Err(error) => return Err(error.into()),
        }
    }
}

/// The recording with its first `replaced` bytes swapped for `head`, as a
/// file next to it. The recorder learns the clip's length only at the end,
/// and writes it into the file's head then.
fn with_head(recording: &Path, head: &[u8], replaced: u64) -> Result<PathBuf, WriteError> {
    let mut source = File::open(recording)?;
    source.seek(SeekFrom::Start(replaced))?;
    let finished = recording.with_extension("finished.webm");
    let mut target = File::create(&finished)?;
    target.write_all(head)?;
    let mut rest = Vec::new();
    source.read_to_end(&mut rest)?;
    target.write_all(&rest)?;
    target.sync_all()?;
    Ok(finished)
}

fn has_room(vault: &Path, bytes: u64) -> bool {
    fs4::available_space(vault).map_or(true, |free| free > bytes)
}

fn take_recording() -> Option<Recording> {
    RECORDING.lock().ok()?.take()
}

/// Starts a new temporary file for a recording. A file left by an earlier
/// recording the app didn't finish stays where it is.
#[tauri::command(async)]
pub fn voice_note_begin() -> Result<Started, WriteError> {
    let recording = begin_in(&folder()?)?;
    if let Ok(mut current) = RECORDING.lock() {
        *current = Some(recording);
    }
    Ok(Started {
        sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
    })
}

/// Adds the body to the recording's temporary file.
#[tauri::command(async)]
pub fn voice_note_append(request: tauri::ipc::Request<'_>) -> Result<(), WriteError> {
    let bytes = export::raw_body(&request)?;
    let mut current = RECORDING.lock().map_err(|e| e.to_string())?;
    let recording = current.as_mut().ok_or_else(|| WriteError::Failed {
        message: "No recording is running.".into(),
    })?;
    recording.file.write_all(bytes)?;
    Ok(())
}

/// Stores the recording in the vault named `x-file-name`. The body replaces
/// the file's first `x-head-replaces` bytes. On failure the recording stays,
/// so saving can be tried again.
#[tauri::command(async)]
pub fn voice_note_save(
    app: tauri::AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<PersistedAttachment, WriteError> {
    let name = export::header(&request, "x-file-name")
        .ok_or_else(|| String::from("The recording has no name."))?;
    let vault_path = export::header(&request, "x-vault-path")
        .ok_or_else(|| String::from("The recording has no vault."))?;
    let replaced: u64 = export::header(&request, "x-head-replaces")
        .and_then(|value| value.parse().ok())
        .unwrap_or_default();
    let head = export::raw_body(&request)?;
    open_vault_only(&vault_path)?;
    let vault = Path::new(&vault_path);

    let mut current = RECORDING.lock().map_err(|e| e.to_string())?;
    let recording = current.as_mut().ok_or_else(|| WriteError::Failed {
        message: "No recording is running.".into(),
    })?;
    recording.file.sync_all()?;
    let finished = with_head(&recording.path, head, replaced)?;
    let size = std::fs::metadata(&finished)?.len();
    if !has_room(vault, size) {
        let _ = std::fs::remove_file(&finished);
        return Err(WriteError::DiskFull);
    }
    let conn = db::open_connection()?;
    let saved = store::persist_attachment_named(&conn, vault, &name, &finished);
    let _ = std::fs::remove_file(&finished);
    let attachment = saved?;
    asset_scope::show_linked_file(&app, Path::new(&attachment.absolute_path));

    if let Some(done) = current.take() {
        drop(done.file);
        let _ = std::fs::remove_file(&done.path);
    }
    Ok(attachment)
}

/// Drops the recording and its temporary file.
#[tauri::command(async)]
pub fn voice_note_discard() {
    if let Some(recording) = take_recording() {
        drop(recording.file);
        let _ = std::fs::remove_file(&recording.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh folder for one test.
    fn folder_for(test: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("netherstone-voice-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn each_recording_gets_a_file_of_its_own() {
        let dir = folder_for("own");
        let first = begin_in(&dir).unwrap();
        let second = begin_in(&dir).unwrap();
        assert_ne!(first.path, second.path);
        assert!(first.path.exists() && second.path.exists());
    }

    #[test]
    fn the_head_is_swapped_and_the_rest_kept() {
        let dir = folder_for("head");
        let mut recording = begin_in(&dir).unwrap();
        recording.file.write_all(b"HEADbody").unwrap();
        let finished = with_head(&recording.path, b"LONGERHEAD", 4).unwrap();
        assert_eq!(std::fs::read(finished).unwrap(), b"LONGERHEADbody");
    }

    #[test]
    fn a_full_disk_is_named() {
        let full = std::io::Error::from(std::io::ErrorKind::StorageFull);
        assert_eq!(WriteError::from(full), WriteError::DiskFull);
        let other = std::io::Error::from(std::io::ErrorKind::PermissionDenied);
        assert!(matches!(WriteError::from(other), WriteError::Failed { .. }));
    }
}
