//! File types, names and sync rules for attachments.

use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use urlencoding::decode;

pub const ATTACHMENTS_DIR_NAME: &str = "_attachments";
pub const SYNC_SOFT_LIMIT_BYTES: u64 = 20 * 1024 * 1024;

const SYNCABLE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "txt", "md", "csv", "json", "xml", "yaml",
    "yml", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    // Audio and video, under the size limit like any other file.
    "mp3", "wav", "ogg", "m4a", "flac", "aac", "opus", "wma", "mp4", "mov", "mkv", "avi", "webm",
    "m4v", "wmv", "flv",
];

const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "dll", "bat", "cmd", "ps1", "sh", "app", "msi", "com", "scr",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum AttachmentReferenceKind {
    Audio,
    File,
    Image,
    Video,
}

impl AttachmentReferenceKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Audio => "audio",
            Self::File => "file",
            Self::Image => "image",
            Self::Video => "video",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AttachmentSyncStatus {
    Syncable,
    LocalOnly,
    Blocked,
    PendingReview,
}

impl AttachmentSyncStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Syncable => "syncable",
            Self::LocalOnly => "local_only",
            Self::Blocked => "blocked",
            Self::PendingReview => "pending_review",
        }
    }
}

pub(crate) fn normalize_slashes(value: &str) -> String {
    value.replace('\\', "/")
}

pub(crate) fn normalize_attachment_path(value: &str) -> Option<String> {
    let stripped = value
        .split('#')
        .next()
        .unwrap_or(value)
        .split('?')
        .next()
        .unwrap_or(value)
        .trim();

    if stripped.is_empty() {
        return None;
    }

    let decoded = decode(stripped)
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| stripped.to_string());
    let normalized = normalize_slashes(&decoded)
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string();

    // A `..` segment leads out of the attachment folder.
    let inside = normalized.split('/').all(|segment| segment != "..");
    if inside && (normalized == ATTACHMENTS_DIR_NAME || normalized.starts_with("_attachments/")) {
        Some(normalized)
    } else {
        None
    }
}

pub(crate) fn extension_for_path(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

pub(crate) fn extension_for_name(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

pub(crate) fn mime_type_for_extension(extension: &str) -> String {
    match extension {
        "aac" => "audio/aac",
        "avi" => "video/x-msvideo",
        "bmp" => "image/bmp",
        "csv" => "text/csv",
        "doc" => "application/msword",
        "docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "flac" => "audio/flac",
        "gif" => "image/gif",
        "htm" | "html" => "text/html",
        "jpeg" | "jpg" => "image/jpeg",
        "json" => "application/json",
        "m4a" => "audio/mp4",
        "m4v" | "mp4" => "video/mp4",
        "md" => "text/markdown",
        "mov" => "video/quicktime",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "opus" => "audio/opus",
        "pdf" => "application/pdf",
        "png" => "image/png",
        "ppt" => "application/vnd.ms-powerpoint",
        "pptx" => "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "svg" => "image/svg+xml",
        "txt" => "text/plain",
        "wav" => "audio/wav",
        "webm" => "video/webm",
        "webp" => "image/webp",
        "xls" => "application/vnd.ms-excel",
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "xml" => "application/xml",
        "yaml" | "yml" => "application/yaml",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
    .to_string()
}

pub(crate) fn reference_kind_for_path(
    path: &str,
    default_kind: AttachmentReferenceKind,
) -> AttachmentReferenceKind {
    let extension = extension_for_name(path);

    match extension.as_str() {
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "tif" | "tiff" => {
            AttachmentReferenceKind::Image
        }
        "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac" | "opus" | "wma" => {
            AttachmentReferenceKind::Audio
        }
        "mp4" | "mov" | "mkv" | "avi" | "webm" | "m4v" | "wmv" | "flv" => {
            AttachmentReferenceKind::Video
        }
        _ => default_kind,
    }
}

pub(crate) fn sync_status_for_attachment(extension: &str, size_bytes: u64) -> AttachmentSyncStatus {
    if BLOCKED_EXTENSIONS.contains(&extension) {
        return AttachmentSyncStatus::Blocked;
    }

    if size_bytes > SYNC_SOFT_LIMIT_BYTES {
        return AttachmentSyncStatus::LocalOnly;
    }

    if SYNCABLE_EXTENSIONS.contains(&extension) {
        AttachmentSyncStatus::Syncable
    } else if extension.is_empty() {
        AttachmentSyncStatus::PendingReview
    } else {
        AttachmentSyncStatus::LocalOnly
    }
}

pub(crate) fn attachment_asset_path(hash: &str, extension: &str) -> String {
    let aa = &hash[0..2];
    let file_name = if extension.is_empty() {
        hash.to_string()
    } else {
        format!("{}.{}", hash, extension)
    };

    format!("{}/{}/{}", ATTACHMENTS_DIR_NAME, aa, file_name)
}

pub(crate) fn path_from_asset_path(vault_path: &Path, asset_path: &str) -> Result<PathBuf, String> {
    let mut path = vault_path.to_path_buf();

    for component in Path::new(asset_path).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            _ => return Err(format!("Invalid attachment path: {}", asset_path)),
        }
    }

    Ok(path)
}

pub(crate) fn is_hash_stem(stem: &str) -> bool {
    stem.len() == 64 && stem.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Files the operating system leaves in folders it has shown, which are not
/// attachments.
pub(crate) fn is_system_file(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "thumbs.db" | "desktop.ini" | ".ds_store"
    )
}

/// A vault attachment's type, size and whether it syncs, from the file on
/// disk as it is now.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSyncInfo {
    pub extension: String,
    pub size_bytes: u64,
    pub sync_status: String,
    /// The size above which files stay on this device.
    pub sync_limit_bytes: u64,
}

/// What the sync rules say about the attachment at `asset_path` today, or
/// nothing when the file isn't there.
pub fn attachment_sync_info(
    vault_path: &Path,
    asset_path: &str,
) -> Result<Option<AttachmentSyncInfo>, String> {
    let asset_path = normalize_attachment_path(asset_path)
        .ok_or_else(|| format!("Not a vault attachment: {}", asset_path))?;
    let path = path_from_asset_path(vault_path, &asset_path)?;
    // A link inside the attachment folder may point anywhere on the device.
    let folder = vault_path.join(ATTACHMENTS_DIR_NAME).canonicalize();
    let (Ok(folder), Ok(target)) = (folder, path.canonicalize()) else {
        return Ok(None);
    };
    if !target.starts_with(&folder) {
        return Ok(None);
    }
    let size_bytes = match std::fs::metadata(&target) {
        Ok(metadata) if metadata.is_file() => metadata.len(),
        _ => return Ok(None),
    };
    let extension = extension_for_path(&path);
    let sync_status = sync_status_for_attachment(&extension, size_bytes)
        .as_str()
        .to_string();

    Ok(Some(AttachmentSyncInfo {
        extension,
        size_bytes,
        sync_status,
        sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
    }))
}

/// A file left by a write that never finished: today's hidden
/// `.name.netherstone-tmp`, or `<hash>.<ext>.tmp` from versions that named
/// attachments by their hash. Any other `.tmp` file is an attachment.
pub(crate) fn is_interrupted_write(asset_path: &str) -> bool {
    if asset_path.ends_with(".netherstone-tmp") {
        return true;
    }
    let name = asset_path.rsplit('/').next().unwrap_or(asset_path);
    name.strip_suffix(".tmp")
        .map(|name| name.split('.').next().unwrap_or(name))
        .is_some_and(is_hash_stem)
}
