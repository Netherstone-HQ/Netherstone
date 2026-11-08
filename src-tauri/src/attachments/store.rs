//! Storing files in the attachment folder: naming, hashing, and finding a
//! copy already there.

use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::policy::{
    ATTACHMENTS_DIR_NAME, SYNC_SOFT_LIMIT_BYTES, attachment_asset_path, extension_for_name,
    extension_for_path, is_hash_stem, is_interrupted_write, is_system_file,
    mime_type_for_extension, normalize_slashes, path_from_asset_path, sync_status_for_attachment,
};
use crate::db::attachments::{is_tracked, now_unix_seconds, vault_key};
use crate::locks::VaultWrites;
use crate::vault;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAttachment {
    pub asset_path: String,
    pub absolute_path: String,
    pub hash: String,
    pub original_name: String,
    pub extension: String,
    pub mime_type: String,
    pub size_bytes: u64,
    pub sync_status: String,
    /// The size above which files stay on this device.
    pub sync_limit_bytes: u64,
}

fn safe_original_name(candidate: &str) -> String {
    let normalized = candidate.replace('\\', "/");
    let name = normalized
        .split('/')
        .next_back()
        .unwrap_or(candidate)
        .trim();

    if name.is_empty() || name == "." || name == ".." {
        "attachment".to_string()
    } else {
        name.to_string()
    }
}

const WINDOWS_RESERVED_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A file name stem that is valid on every platform, keeping the original
/// name as far as possible.
fn portable_file_stem(stem: &str) -> String {
    let replaced: String = stem
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    let mut stem: String = replaced
        .trim()
        .trim_end_matches(['.', ' '])
        .chars()
        .take(100)
        .collect();
    stem = stem.trim_end_matches(['.', ' ']).to_string();

    if stem.is_empty() || stem.starts_with('.') {
        stem = format!("attachment{}", stem);
    }
    if WINDOWS_RESERVED_NAMES.contains(&stem.to_ascii_lowercase().as_str()) {
        stem.push_str("-file");
    }

    stem
}

/// The `_attachments/<name>` paths for `original_name`, in the order they
/// are tried: the name itself, then `-1`, `-2`, ...
fn readable_asset_paths(original_name: &str, extension: &str) -> impl Iterator<Item = String> {
    let raw_stem = Path::new(original_name)
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(original_name);
    let stem = portable_file_stem(raw_stem);
    let suffix = if extension.is_empty() {
        String::new()
    } else {
        format!(".{}", extension)
    };

    (0..).map(move |n| {
        if n == 0 {
            format!("{}/{}{}", ATTACHMENTS_DIR_NAME, stem, suffix)
        } else {
            format!("{}/{}-{}{}", ATTACHMENTS_DIR_NAME, stem, n, suffix)
        }
    })
}

pub(crate) fn upsert_attachment_record(
    conn: &Connection,
    vault_path: &Path,
    attachment: &PersistedAttachment,
) -> Result<(), String> {
    let now = now_unix_seconds();

    conn.execute(
        "INSERT INTO attachments (vault_path, asset_path, hash, original_name, extension, mime_type, size_bytes, created_at, updated_at, sync_status, ref_count, last_referenced_at, gc_candidate_at)
         VALUES (?9, ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, 0, NULL, NULL)
         ON CONFLICT(vault_path, asset_path) DO UPDATE SET
             hash = excluded.hash,
             extension = excluded.extension,
             mime_type = excluded.mime_type,
             size_bytes = excluded.size_bytes,
             updated_at = excluded.updated_at,
             sync_status = excluded.sync_status",
        params![
            attachment.asset_path,
            attachment.hash,
            attachment.original_name,
            attachment.extension,
            attachment.mime_type,
            attachment.size_bytes as i64,
            now,
            attachment.sync_status,
            vault_key(vault_path),
        ],
    )
    .map_err(|e| format!("Failed to upsert attachment metadata: {}", e))?;

    Ok(())
}

/// What a new attachment is made from.
enum AttachmentSource<'a> {
    Bytes(&'a [u8]),
    File(&'a Path),
}

/// Puts `staged` in the attachment folder under the first free name for
/// `original_name`. Each name is claimed by creating it as a new, empty
/// file, so a name taken by anything, even another program a moment ago, is
/// never replaced: the attachment moves on to the next one.
fn put_new_attachment(
    writes: &VaultWrites,
    vault_path: &Path,
    original_name: &str,
    extension: &str,
    staged: vault::StagedFile,
) -> Result<(String, PathBuf), String> {
    for asset_path in readable_asset_paths(original_name, extension) {
        let destination = path_from_asset_path(vault_path, &asset_path)?;
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&destination)
        {
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Failed to write attachment: {}", e)),
        }
        if let Err(error) = staged.put(writes, &destination) {
            let _ = std::fs::remove_file(&destination);
            return Err(error);
        }
        return Ok((asset_path, destination));
    }
    Err("No free attachment name".to_string())
}

/// The content hash and size of the file at `path`, read a piece at a time.
fn hash_file(path: &Path) -> Result<(String, u64), String> {
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let mut hasher = blake3::Hasher::new();
    let size = std::io::copy(&mut std::io::BufReader::new(file), &mut hasher)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    Ok((hasher.finalize().to_hex().to_string(), size))
}

/// An attachment in this vault with the same content: a tracked file with
/// that hash, or a file stored under its hash name before names were
/// readable. Sizes are compared in case a file was edited after tracking.
pub(crate) fn find_identical_attachment(
    conn: &Connection,
    vault_path: &Path,
    hash: &str,
    extension: &str,
    size_bytes: u64,
    exclude_asset_path: Option<&str>,
) -> Result<Option<String>, String> {
    let mut candidates: Vec<String> = {
        let mut stmt = conn
            .prepare(
                "SELECT asset_path FROM attachments WHERE vault_path = ?1 AND hash = ?2 ORDER BY asset_path",
            )
            .map_err(|e| format!("Failed to prepare attachment hash query: {}", e))?;
        let rows = stmt
            .query_map(params![vault_key(vault_path), hash], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| format!("Failed to query attachments by hash: {}", e))?;
        rows.filter_map(Result::ok).collect()
    };
    if hash.len() >= 2 {
        candidates.push(attachment_asset_path(hash, extension));
    }

    Ok(candidates.into_iter().find(|asset_path| {
        Some(asset_path.as_str()) != exclude_asset_path
            && path_from_asset_path(vault_path, asset_path)
                .ok()
                .and_then(|path| std::fs::metadata(path).ok())
                .is_some_and(|meta| meta.is_file() && meta.len() == size_bytes)
    }))
}

/// Stores `bytes` as a new attachment named after `original_name`, or links
/// the attachment already in the vault with the same content.
pub fn persist_attachment_bytes(
    conn: &Connection,
    vault_path: &Path,
    original_name: &str,
    bytes: &[u8],
) -> Result<PersistedAttachment, String> {
    let hash = blake3::hash(bytes).to_hex().to_string();
    let attachment = persist_attachment(
        conn,
        vault_path,
        original_name,
        &hash,
        bytes.len() as u64,
        AttachmentSource::Bytes(bytes),
    )?;

    // A copy already in the vault is as new as these bytes. Drawing pictures
    // are re-exported when older than their drawing, so one exported again
    // unchanged must not stay older.
    let _ = std::fs::File::options()
        .write(true)
        .open(&attachment.absolute_path)
        .and_then(|file| file.set_modified(SystemTime::now()));

    Ok(attachment)
}

/// Writes the new attachment before taking `writes.lock`, so a big file
/// doesn't hold up saves; the lock is only held to name it.
fn persist_attachment(
    conn: &Connection,
    vault_path: &Path,
    original_name: &str,
    hash: &str,
    size_bytes: u64,
    source: AttachmentSource<'_>,
) -> Result<PersistedAttachment, String> {
    if !vault_path.is_dir() {
        return Err(format!(
            "Vault path is not a directory: {}",
            vault_path.display()
        ));
    }

    if size_bytes == 0 {
        return Err("Cannot attach an empty file.".to_string());
    }

    let original_name = safe_original_name(original_name);
    let extension = extension_for_name(&original_name);

    // Importing the same file again links the copy already in the vault.
    if let Some(asset_path) =
        find_identical_attachment(conn, vault_path, hash, &extension, size_bytes, None)?
    {
        return register_existing_attachment(conn, vault_path, &asset_path);
    }

    let folder = vault_path.join(ATTACHMENTS_DIR_NAME);
    std::fs::create_dir_all(&folder).map_err(|e| {
        format!(
            "Failed to create attachment directory {}: {}",
            folder.display(),
            e
        )
    })?;
    let staged = match source {
        AttachmentSource::Bytes(bytes) => vault::stage_file(&folder, |file| file.write_all(bytes)),
        AttachmentSource::File(path) => vault::stage_file(&folder, |file| {
            std::io::copy(&mut std::fs::File::open(path)?, file).map(drop)
        }),
    }?;

    let writes = crate::locks::vault_writes()?;
    // The same file may have been stored while this copy was written.
    if let Some(asset_path) =
        find_identical_attachment(conn, vault_path, hash, &extension, size_bytes, None)?
    {
        return register_existing_attachment(conn, vault_path, &asset_path);
    }
    let (asset_path, destination) =
        put_new_attachment(&writes, vault_path, &original_name, &extension, staged)?;

    let sync_status = sync_status_for_attachment(&extension, size_bytes);
    let attachment = PersistedAttachment {
        asset_path,
        absolute_path: destination.to_string_lossy().to_string(),
        hash: hash.to_string(),
        original_name,
        extension: extension.clone(),
        mime_type: mime_type_for_extension(&extension),
        size_bytes,
        sync_status: sync_status.as_str().to_string(),
        sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
    };

    upsert_attachment_record(conn, vault_path, &attachment)?;

    Ok(attachment)
}

/// The asset path of `path` when it is already a file in the vault's
/// attachment folder, such as an attachment renamed outside the app.
fn existing_attachment_asset_path(vault_path: &Path, path: &Path) -> Option<String> {
    let attachments_dir = vault_path.join(ATTACHMENTS_DIR_NAME).canonicalize().ok()?;
    let vault = vault_path.canonicalize().ok()?;
    let target = path.canonicalize().ok()?;
    if !target.starts_with(&attachments_dir) {
        return None;
    }

    let relative = target.strip_prefix(&vault).ok()?;
    Some(normalize_slashes(&relative.to_string_lossy()))
}

/// Tracks a file that is already in the attachment folder under its current
/// name, instead of copying it to a new one.
fn register_existing_attachment(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
) -> Result<PersistedAttachment, String> {
    let absolute_path = path_from_asset_path(vault_path, asset_path)?;
    let (hash, size_bytes) = hash_file(&absolute_path)?;
    let extension = extension_for_path(&absolute_path);
    let attachment = PersistedAttachment {
        asset_path: asset_path.to_string(),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        hash,
        original_name: absolute_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("attachment")
            .to_string(),
        extension: extension.clone(),
        mime_type: mime_type_for_extension(&extension),
        size_bytes,
        sync_status: sync_status_for_attachment(&extension, size_bytes)
            .as_str()
            .to_string(),
        sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
    };

    let mut attachment = attachment;
    upsert_attachment_record(conn, vault_path, &attachment)?;
    // Keep the name it was first imported under.
    attachment.original_name = conn
        .query_row(
            "SELECT original_name FROM attachments WHERE vault_path = ?1 AND asset_path = ?2",
            params![vault_key(vault_path), asset_path],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query attachment metadata: {}", e))?;
    Ok(attachment)
}

/// Copies the file at `source_path` in as a new attachment, or links the
/// attachment already in the vault with the same content. A file already in
/// the attachment folder is tracked where it is.
pub fn persist_attachment_file(
    conn: &Connection,
    vault_path: &Path,
    source_path: &Path,
) -> Result<PersistedAttachment, String> {
    if !source_path.is_file() {
        return Err(format!(
            "Source path is not a file: {}",
            source_path.display()
        ));
    }

    if let Some(asset_path) = existing_attachment_asset_path(vault_path, source_path) {
        return register_existing_attachment(conn, vault_path, &asset_path);
    }

    let (hash, size_bytes) = hash_file(source_path)?;
    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment");

    persist_attachment(
        conn,
        vault_path,
        original_name,
        &hash,
        size_bytes,
        AttachmentSource::File(source_path),
    )
}

/// Lists the files under the vault's attachment folder as asset paths, with
/// their sizes.
pub(crate) fn scan_attachment_files(vault_path: &Path) -> Vec<(String, u64)> {
    let mut files = Vec::new();
    let mut pending = vec![vault_path.join(ATTACHMENTS_DIR_NAME)];

    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };

        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };

            if file_type.is_dir() {
                pending.push(path);
            } else if file_type.is_file() {
                if is_system_file(&entry.file_name().to_string_lossy()) {
                    continue;
                }
                let Ok(relative) = path.strip_prefix(vault_path) else {
                    continue;
                };
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                files.push((normalize_slashes(&relative.to_string_lossy()), size));
            }
        }
    }

    files.sort();
    files
}

/// Registers an attachment file that has no database row, naming its hash
/// after the file when it was stored by content hash, so large files are not
/// re-read.
pub(crate) fn register_untracked_attachment(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
    size_bytes: u64,
) -> Result<(), String> {
    let absolute_path = path_from_asset_path(vault_path, asset_path)?;
    let stem = absolute_path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or_default();
    let hash = if is_hash_stem(stem) {
        stem.to_ascii_lowercase()
    } else {
        hash_file(&absolute_path)?.0
    };
    let extension = extension_for_path(&absolute_path);
    let original_name = absolute_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_string();

    upsert_attachment_record(
        conn,
        vault_path,
        &PersistedAttachment {
            asset_path: asset_path.to_string(),
            absolute_path: absolute_path.to_string_lossy().to_string(),
            hash,
            original_name,
            extension: extension.clone(),
            mime_type: mime_type_for_extension(&extension),
            size_bytes,
            sync_status: sync_status_for_attachment(&extension, size_bytes)
                .as_str()
                .to_string(),
            sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
        },
    )
}

/// Registers every file in the attachment folder the database does not
/// track yet. Returns their asset paths.
pub(crate) fn register_untracked_attachments(
    conn: &Connection,
    vault_path: &Path,
    disk_files: &[(String, u64)],
) -> Result<HashSet<String>, String> {
    let mut registered = HashSet::new();
    for (asset_path, size_bytes) in disk_files {
        // Leftovers from an interrupted write are not attachments.
        if is_interrupted_write(asset_path) {
            continue;
        }

        if !is_tracked(conn, vault_path, asset_path)? {
            register_untracked_attachment(conn, vault_path, asset_path, *size_bytes)?;
            registered.insert(asset_path.clone());
        }
    }

    Ok(registered)
}
