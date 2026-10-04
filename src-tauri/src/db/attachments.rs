use pulldown_cmark::{Event, Parser, Tag, TagEnd};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use urlencoding::decode;

pub const ATTACHMENTS_DIR_NAME: &str = "_attachments";
pub const SYNC_SOFT_LIMIT_BYTES: u64 = 20 * 1024 * 1024;

const SYNCABLE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "pdf", "txt", "md", "csv", "json", "xml", "yaml",
    "yml", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
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
    fn as_str(self) -> &'static str {
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
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ParsedAttachmentReference {
    asset_path: String,
    reference_kind: AttachmentReferenceKind,
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn normalize_slashes(value: &str) -> String {
    value.replace('\\', "/")
}

fn normalize_attachment_path(value: &str) -> Option<String> {
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

    if normalized == ATTACHMENTS_DIR_NAME || normalized.starts_with("_attachments/") {
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

fn extension_for_name(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

fn mime_type_for_extension(extension: &str) -> String {
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

fn reference_kind_for_path(
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

fn safe_original_name(candidate: &str) -> String {
    let normalized = candidate.replace('\\', "/");
    let name = normalized.split('/').last().unwrap_or(candidate).trim();

    if name.is_empty() || name == "." || name == ".." {
        "attachment".to_string()
    } else {
        name.to_string()
    }
}

fn attachment_asset_path(hash: &str, extension: &str) -> String {
    let aa = &hash[0..2];
    let file_name = if extension.is_empty() {
        hash.to_string()
    } else {
        format!("{}.{}", hash, extension)
    };

    format!("{}/{}/{}", ATTACHMENTS_DIR_NAME, aa, file_name)
}

fn path_from_asset_path(vault_path: &Path, asset_path: &str) -> Result<PathBuf, String> {
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

fn upsert_attachment_record(
    conn: &Connection,
    attachment: &PersistedAttachment,
) -> Result<(), String> {
    let now = now_unix_seconds();

    conn.execute(
        "INSERT INTO attachments (asset_path, hash, original_name, extension, mime_type, size_bytes, created_at, updated_at, sync_status, ref_count, last_referenced_at, gc_candidate_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, 0, NULL, NULL)
         ON CONFLICT(asset_path) DO UPDATE SET
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
        ],
    )
    .map_err(|e| format!("Failed to upsert attachment metadata: {}", e))?;

    Ok(())
}

/// Makes sure `asset_path` has a database row, creating it from the file on
/// disk if needed. Returns false when there is no row because the file is
/// missing.
fn ensure_attachment_record_for_existing_asset(
    conn: &Connection,
    vault_path: Option<&Path>,
    asset_path: &str,
) -> Result<bool, String> {
    let exists: Option<String> = conn
        .query_row(
            "SELECT asset_path FROM attachments WHERE asset_path = ?1",
            params![asset_path],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to query attachment metadata: {}", e))?;

    if exists.is_some() {
        return Ok(true);
    }

    let Some(vault_path) = vault_path else {
        return Ok(false);
    };

    let absolute_path = path_from_asset_path(vault_path, asset_path)?;
    if !absolute_path.is_file() {
        return Ok(false);
    }

    let bytes = std::fs::read(&absolute_path).map_err(|e| {
        format!(
            "Failed to read attachment {}: {}",
            absolute_path.display(),
            e
        )
    })?;
    let hash = blake3::hash(&bytes).to_hex().to_string();
    let extension = extension_for_path(&absolute_path);
    let original_name = absolute_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_string();
    let sync_status = sync_status_for_attachment(&extension, bytes.len() as u64);

    let attachment = PersistedAttachment {
        asset_path: asset_path.to_string(),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        hash,
        original_name,
        extension: extension.clone(),
        mime_type: mime_type_for_extension(&extension),
        size_bytes: bytes.len() as u64,
        sync_status: sync_status.as_str().to_string(),
    };

    upsert_attachment_record(conn, &attachment)?;
    Ok(true)
}

fn html_reference_kind(html: &str) -> AttachmentReferenceKind {
    let lower = html.trim_start().to_ascii_lowercase();

    if lower.starts_with("<audio") {
        AttachmentReferenceKind::Audio
    } else if lower.starts_with("<video") {
        AttachmentReferenceKind::Video
    } else if lower.starts_with("<img") {
        AttachmentReferenceKind::Image
    } else {
        AttachmentReferenceKind::File
    }
}

fn extract_html_attr_value(html: &str, attr_name: &str) -> Option<String> {
    let lower_html = html.to_ascii_lowercase();
    let lower_attr = attr_name.to_ascii_lowercase();
    let mut search_start = 0;

    while let Some(relative_index) = lower_html[search_start..].find(&lower_attr) {
        let attr_start = search_start + relative_index;
        let before = html[..attr_start].chars().next_back();
        let after_index = attr_start + attr_name.len();
        let after = html[after_index..].chars().next();

        let boundary_before = before.is_none_or(|c| c.is_whitespace() || c == '<');
        let boundary_after = after.is_none_or(|c| c.is_whitespace() || c == '=');

        if !boundary_before || !boundary_after {
            search_start = after_index;
            continue;
        }

        let mut rest = html[after_index..].trim_start();
        if !rest.starts_with('=') {
            search_start = after_index;
            continue;
        }

        rest = rest[1..].trim_start();
        let Some(quote) = rest.chars().next() else {
            return None;
        };

        if quote == '"' || quote == '\'' {
            let value_start = quote.len_utf8();
            let value_rest = &rest[value_start..];
            let value_end = value_rest.find(quote).unwrap_or(value_rest.len());
            return Some(value_rest[..value_end].to_string());
        }

        let value_end = rest
            .find(|c: char| c.is_whitespace() || c == '>')
            .unwrap_or(rest.len());
        return Some(rest[..value_end].to_string());
    }

    None
}

fn push_html_attachment_reference(references: &mut Vec<ParsedAttachmentReference>, html: &str) {
    let default_kind = html_reference_kind(html);
    let mut seen_paths = HashSet::new();

    for attr_name in ["netherstoneStoredSource", "src", "href"] {
        let Some(value) = extract_html_attr_value(html, attr_name) else {
            continue;
        };
        let Some(asset_path) = normalize_attachment_path(&value) else {
            continue;
        };

        if !seen_paths.insert(asset_path.clone()) {
            continue;
        }

        let reference_kind = reference_kind_for_path(&asset_path, default_kind);

        references.push(ParsedAttachmentReference {
            asset_path,
            reference_kind,
        });
    }
}

fn parse_attachment_references(content: &str) -> Vec<ParsedAttachmentReference> {
    let parser = Parser::new(content);
    let mut references = Vec::new();

    for event in parser {
        match event {
            Event::Start(Tag::Image { dest_url, .. }) => {
                if let Some(asset_path) = normalize_attachment_path(&dest_url) {
                    let reference_kind =
                        reference_kind_for_path(&asset_path, AttachmentReferenceKind::Image);
                    references.push(ParsedAttachmentReference {
                        asset_path,
                        reference_kind,
                    });
                }
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                if let Some(asset_path) = normalize_attachment_path(&dest_url) {
                    let reference_kind =
                        reference_kind_for_path(&asset_path, AttachmentReferenceKind::File);
                    references.push(ParsedAttachmentReference {
                        asset_path,
                        reference_kind,
                    });
                }
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                push_html_attachment_reference(&mut references, &html);
            }
            Event::End(TagEnd::Image) | Event::End(TagEnd::Link) => {}
            _ => {}
        }
    }

    references
}

fn refresh_attachment_counts(
    conn: &Connection,
    asset_paths: &HashSet<String>,
) -> Result<(), String> {
    let now = now_unix_seconds();

    for asset_path in asset_paths {
        let ref_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachment_references WHERE asset_path = ?1",
                params![asset_path],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count attachment references: {}", e))?;

        if ref_count > 0 {
            conn.execute(
                "UPDATE attachments SET ref_count = ?1, last_referenced_at = ?2, gc_candidate_at = NULL, updated_at = ?2 WHERE asset_path = ?3",
                params![ref_count, now, asset_path],
            )
            .map_err(|e| format!("Failed to mark attachment as referenced: {}", e))?;
        } else {
            conn.execute(
                "UPDATE attachments SET ref_count = 0, gc_candidate_at = COALESCE(gc_candidate_at, ?1), updated_at = ?1 WHERE asset_path = ?2",
                params![now, asset_path],
            )
            .map_err(|e| format!("Failed to mark attachment as GC candidate: {}", e))?;
        }
    }

    Ok(())
}

/// Serializes choosing a file name and writing it, so two files with the
/// same name imported at once don't overwrite each other.
static ATTACHMENT_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

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

/// The first free `_attachments/<name>` for `original_name`, adding `-1`,
/// `-2`, ... when the name is taken.
fn readable_asset_path(vault_path: &Path, original_name: &str, extension: &str) -> String {
    readable_asset_path_avoiding(vault_path, original_name, extension, &HashSet::new())
}

/// Like `readable_asset_path`, also skipping names in `taken`.
fn readable_asset_path_avoiding(
    vault_path: &Path,
    original_name: &str,
    extension: &str,
    taken: &HashSet<String>,
) -> String {
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

    (0..)
        .map(|n| {
            if n == 0 {
                format!("{}/{}{}", ATTACHMENTS_DIR_NAME, stem, suffix)
            } else {
                format!("{}/{}-{}{}", ATTACHMENTS_DIR_NAME, stem, n, suffix)
            }
        })
        .find(|asset_path| {
            !taken.contains(asset_path)
                && path_from_asset_path(vault_path, asset_path).is_ok_and(|path| !path.exists())
        })
        .expect("an unused attachment name")
}

/// An attachment in this vault with the same content: a tracked file with
/// that hash, or a file stored under its hash name before names were
/// readable. Sizes are compared in case a file was edited after tracking.
fn find_identical_attachment(
    conn: &Connection,
    vault_path: &Path,
    hash: &str,
    extension: &str,
    size_bytes: u64,
    exclude_asset_path: Option<&str>,
) -> Result<Option<String>, String> {
    let mut candidates: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT asset_path FROM attachments WHERE hash = ?1 ORDER BY asset_path")
            .map_err(|e| format!("Failed to prepare attachment hash query: {}", e))?;
        let rows = stmt
            .query_map(params![hash], |row| row.get::<_, String>(0))
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

pub fn persist_attachment_bytes(
    conn: &Connection,
    vault_path: &Path,
    original_name: &str,
    bytes: &[u8],
) -> Result<PersistedAttachment, String> {
    if !vault_path.is_dir() {
        return Err(format!(
            "Vault path is not a directory: {}",
            vault_path.display()
        ));
    }

    if bytes.is_empty() {
        return Err("Cannot attach an empty file.".to_string());
    }

    let original_name = safe_original_name(original_name);
    let extension = extension_for_name(&original_name);
    let hash = blake3::hash(bytes).to_hex().to_string();
    let _write_guard = ATTACHMENT_WRITE_LOCK
        .lock()
        .map_err(|e| format!("Failed to lock attachment writes: {}", e))?;

    // Importing the same file again links the copy already in the vault.
    if let Some(asset_path) = find_identical_attachment(
        conn,
        vault_path,
        &hash,
        &extension,
        bytes.len() as u64,
        None,
    )? {
        return register_existing_attachment(conn, vault_path, &asset_path);
    }

    let asset_path = readable_asset_path(vault_path, &original_name, &extension);
    let destination = path_from_asset_path(vault_path, &asset_path)?;

    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create attachment directory {}: {}",
                parent.display(),
                e
            )
        })?;
    }

    let mut tmp_name = destination.as_os_str().to_owned();
    tmp_name.push(".tmp");
    let tmp_path = PathBuf::from(tmp_name);
    std::fs::write(&tmp_path, bytes).map_err(|e| format!("Failed to write attachment: {}", e))?;
    std::fs::rename(&tmp_path, &destination)
        .map_err(|e| format!("Failed to finalize attachment: {}", e))?;

    let sync_status = sync_status_for_attachment(&extension, bytes.len() as u64);
    let attachment = PersistedAttachment {
        asset_path,
        absolute_path: destination.to_string_lossy().to_string(),
        hash,
        original_name,
        extension: extension.clone(),
        mime_type: mime_type_for_extension(&extension),
        size_bytes: bytes.len() as u64,
        sync_status: sync_status.as_str().to_string(),
    };

    upsert_attachment_record(conn, &attachment)?;

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
    let bytes = std::fs::read(&absolute_path).map_err(|e| {
        format!(
            "Failed to read attachment {}: {}",
            absolute_path.display(),
            e
        )
    })?;
    let extension = extension_for_path(&absolute_path);
    let size_bytes = bytes.len() as u64;
    let attachment = PersistedAttachment {
        asset_path: asset_path.to_string(),
        absolute_path: absolute_path.to_string_lossy().to_string(),
        hash: blake3::hash(&bytes).to_hex().to_string(),
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
    };

    let mut attachment = attachment;
    upsert_attachment_record(conn, &attachment)?;
    // Keep the name it was first imported under.
    attachment.original_name = conn
        .query_row(
            "SELECT original_name FROM attachments WHERE asset_path = ?1",
            params![asset_path],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to query attachment metadata: {}", e))?;
    Ok(attachment)
}

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

    let bytes = std::fs::read(source_path).map_err(|e| {
        format!(
            "Failed to read source attachment {}: {}",
            source_path.display(),
            e
        )
    })?;
    let original_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment");

    persist_attachment_bytes(conn, vault_path, original_name, &bytes)
}

pub fn sync_references_for_saved_markdown(
    conn: &Connection,
    file_path: &str,
    content: &str,
) -> Result<(), String> {
    let references = parse_attachment_references(content);
    let vault_path = Path::new(file_path)
        .parent()
        .and_then(find_vault_root_for_markdown_file);
    let now = now_unix_seconds();

    let previous_paths: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT asset_path FROM attachment_references WHERE file_path = ?1")
            .map_err(|e| format!("Failed to prepare attachment reference query: {}", e))?;
        let rows = stmt
            .query_map(params![file_path], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query attachment references: {}", e))?;

        rows.filter_map(Result::ok).collect()
    };

    conn.execute(
        "DELETE FROM attachment_references WHERE file_path = ?1",
        params![file_path],
    )
    .map_err(|e| format!("Failed to clear attachment references: {}", e))?;

    let mut current_by_path: HashMap<String, AttachmentReferenceKind> = HashMap::new();
    for reference in references {
        current_by_path
            .entry(reference.asset_path)
            .or_insert(reference.reference_kind);
    }

    for (asset_path, reference_kind) in &current_by_path {
        // A link to a missing file can't be stored (references need an
        // attachment row). Reconciliation reports those links instead.
        if !ensure_attachment_record_for_existing_asset(conn, vault_path.as_deref(), asset_path)? {
            continue;
        }
        conn.execute(
            "INSERT OR REPLACE INTO attachment_references (file_path, asset_path, reference_kind, detected_at) VALUES (?1, ?2, ?3, ?4)",
            params![file_path, asset_path, reference_kind.as_str(), now],
        )
        .map_err(|e| format!("Failed to insert attachment reference: {}", e))?;
    }

    let mut touched_paths = previous_paths;
    touched_paths.extend(current_by_path.keys().cloned());
    refresh_attachment_counts(conn, &touched_paths)
}

pub fn rename_reference_file_path(
    conn: &Connection,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE attachment_references SET file_path = ?1 WHERE file_path = ?2",
        params![new_path, old_path],
    )
    .map_err(|e| format!("Failed to rename attachment references: {}", e))?;

    Ok(())
}

pub fn remove_references_for_markdown_file(
    conn: &Connection,
    file_path: &str,
) -> Result<(), String> {
    let previous_paths: HashSet<String> = {
        let mut stmt = conn
            .prepare("SELECT asset_path FROM attachment_references WHERE file_path = ?1")
            .map_err(|e| format!("Failed to prepare attachment reference query: {}", e))?;
        let rows = stmt
            .query_map(params![file_path], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query attachment references: {}", e))?;

        rows.filter_map(Result::ok).collect()
    };

    conn.execute(
        "DELETE FROM attachment_references WHERE file_path = ?1",
        params![file_path],
    )
    .map_err(|e| format!("Failed to delete attachment references: {}", e))?;

    refresh_attachment_counts(conn, &previous_paths)
}

fn find_vault_root_for_markdown_file(start_dir: &Path) -> Option<PathBuf> {
    let mut current = Some(start_dir);

    while let Some(dir) = current {
        if dir.join(ATTACHMENTS_DIR_NAME).exists() {
            return Some(dir.to_path_buf());
        }
        current = dir.parent();
    }

    // If the attachment folder has not been created yet, the direct parent is
    // the best available root for pre-existing markdown reference indexing.
    Some(start_dir.to_path_buf())
}

/// An attachment that shards in the vault link to but is not on disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingAttachment {
    pub asset_path: String,
    pub shard_paths: Vec<String>,
    /// The name the file had when it was imported, if known.
    pub original_name: Option<String>,
    /// A file in the vault with the same content, such as the missing file
    /// after a rename or move, that the links can point to instead.
    pub found_asset_path: Option<String>,
}

/// What is known about one missing attachment.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingAttachmentInfo {
    pub original_name: Option<String>,
    pub found_asset_path: Option<String>,
    pub found_absolute_path: Option<String>,
}

/// A file in the vault's attachment folder that no shard links to.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnusedAttachment {
    pub asset_path: String,
    pub size_bytes: u64,
    /// When the database first saw it unused (unix seconds).
    pub unused_since: Option<i64>,
}

/// The state of a vault's attachments after reconciliation.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReport {
    pub file_count: usize,
    pub total_bytes: u64,
    pub missing: Vec<MissingAttachment>,
    pub unused: Vec<UnusedAttachment>,
    /// Database rows created for files that were not tracked yet.
    pub registered_count: usize,
    /// Shards whose stale references were dropped because they no longer exist.
    pub removed_shard_count: usize,
    /// Files that shards link to outside the attachment folder.
    pub external_files: Vec<ExternalFile>,
    /// Moves that put every attachment in the flat folder under a readable
    /// name where one is known.
    pub tidy_renames: Vec<PlannedRename>,
}

/// One place a shard links to an external file, as written in the shard.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFileUse {
    pub shard_path: String,
    pub link: String,
}

/// A file on this device that shards link to by a path outside the vault's
/// attachment folder, such as `images/a.png` or `C:\\Users\\me\\a.png`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFile {
    pub absolute_path: String,
    pub size_bytes: u64,
    pub inside_vault: bool,
    pub uses: Vec<ExternalFileUse>,
}

/// An attachment and the flat, readable path it can move to.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PlannedRename {
    pub from: String,
    pub to: String,
}

fn is_hash_stem(stem: &str) -> bool {
    stem.len() == 64 && stem.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Every link destination in `content`: markdown images and links, and the
/// source attributes of HTML media tags, with HTML entities decoded.
fn parse_link_destinations(content: &str) -> Vec<String> {
    let mut destinations = Vec::new();

    for event in Parser::new(content) {
        match event {
            Event::Start(Tag::Image { dest_url, .. })
            | Event::Start(Tag::Link { dest_url, .. }) => {
                destinations.push(dest_url.to_string());
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                for attr_name in ["netherstoneStoredSource", "src", "href"] {
                    if let Some(value) = extract_html_attr_value(&html, attr_name) {
                        destinations.push(
                            value
                                .replace("&quot;", "\"")
                                .replace("&lt;", "<")
                                .replace("&gt;", ">")
                                .replace("&amp;", "&"),
                        );
                    }
                }
            }
            _ => {}
        }
    }

    destinations
}

/// The file a link destination points to on this device, if it is a local
/// path rather than a web address or anchor.
fn resolve_local_link(link: &str, shard_dir: &Path) -> Option<PathBuf> {
    let link = link.trim();
    if link.is_empty() || link.starts_with('#') {
        return None;
    }

    let is_windows_absolute = link.len() > 2
        && link.as_bytes()[0].is_ascii_alphabetic()
        && link.as_bytes()[1] == b':'
        && matches!(link.as_bytes()[2], b'\\' | b'/');
    let path_text = if let Some(rest) = link.strip_prefix("file://") {
        // file:///C:/a.png and file:///home/a.png
        let rest = rest.strip_prefix('/').filter(|r| {
            r.len() > 1 && r.as_bytes()[0].is_ascii_alphabetic() && r.as_bytes()[1] == b':'
        });
        rest.map(str::to_string)
            .unwrap_or_else(|| link["file://".len()..].to_string())
    } else if !is_windows_absolute
        && link.split_once(':').is_some_and(|(scheme, _)| {
            !scheme.is_empty()
                && scheme
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
        })
    {
        // http:, data:, mailto:, mention links and other schemes.
        return None;
    } else {
        link.split(['?', '#']).next().unwrap_or(link).to_string()
    };

    let decoded = decode(&path_text)
        .map(|value| value.into_owned())
        .unwrap_or(path_text);
    let path = Path::new(&decoded);
    let resolved = if path.is_absolute() || is_windows_absolute {
        path.to_path_buf()
    } else {
        shard_dir.join(path)
    };

    resolved.is_file().then_some(resolved)
}

/// Shard links to files that are not managed attachments: files elsewhere
/// in the vault or on this device. Notes and drawings are not attachments.
fn find_external_files(vault_path: &Path, shards: &[(String, String)]) -> Vec<ExternalFile> {
    let attachments_dir = vault_path
        .join(ATTACHMENTS_DIR_NAME)
        .canonicalize()
        .unwrap_or_else(|_| vault_path.join(ATTACHMENTS_DIR_NAME));
    let vault = vault_path
        .canonicalize()
        .unwrap_or_else(|_| vault_path.to_path_buf());
    let mut by_path: HashMap<PathBuf, ExternalFile> = HashMap::new();

    for (shard_path, content) in shards {
        let shard_dir = Path::new(shard_path).parent().unwrap_or(vault_path);
        let mut seen = HashSet::new();

        for link in parse_link_destinations(content) {
            if normalize_attachment_path(&link).is_some() || !seen.insert(link.clone()) {
                continue;
            }
            let Some(resolved) = resolve_local_link(&link, shard_dir) else {
                continue;
            };
            let extension = extension_for_path(&resolved);
            if extension.is_empty()
                || matches!(
                    extension.as_str(),
                    "md" | "markdown" | "excalidraw" | "htm" | "html"
                )
            {
                continue;
            }
            let canonical = resolved.canonicalize().unwrap_or(resolved);
            if canonical.starts_with(&attachments_dir) {
                continue;
            }

            let size_bytes = std::fs::metadata(&canonical).map(|m| m.len()).unwrap_or(0);
            by_path
                .entry(canonical.clone())
                .or_insert_with(|| ExternalFile {
                    absolute_path: canonical.to_string_lossy().to_string(),
                    size_bytes,
                    inside_vault: canonical.starts_with(&vault),
                    uses: Vec::new(),
                })
                .uses
                .push(ExternalFileUse {
                    shard_path: shard_path.clone(),
                    link,
                });
        }
    }

    let mut files: Vec<ExternalFile> = by_path.into_values().collect();
    files.sort_by(|a, b| a.absolute_path.cmp(&b.absolute_path));
    files
}

/// Moves that tidy the attachment folder into one flat, readable folder.
/// Files stored under their content hash get the name of the file they were
/// imported from, and files in subfolders (the old two-letter hash folders)
/// move up to `_attachments/`. A hash-named file whose original name is
/// unknown keeps its name but still moves up.
fn plan_tidy_renames(
    conn: &Connection,
    vault_path: &Path,
    disk_files: &[(String, u64)],
) -> Result<Vec<PlannedRename>, String> {
    let root_prefix = format!("{}/", ATTACHMENTS_DIR_NAME);
    let mut taken = HashSet::new();
    let mut renames = Vec::new();

    for (asset_path, _) in disk_files {
        if asset_path.ends_with(".tmp") {
            continue;
        }
        let path = Path::new(asset_path);
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or_default();
        let in_subfolder = asset_path
            .strip_prefix(&root_prefix)
            .is_some_and(|rest| rest.contains('/'));

        let original_name = if is_hash_stem(stem) {
            let original_name: Option<String> = conn
                .query_row(
                    "SELECT original_name FROM attachments WHERE asset_path = ?1",
                    params![asset_path],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| format!("Failed to query attachment metadata: {}", e))?;
            original_name.filter(|name| {
                let original_stem = Path::new(name)
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or_default();
                !original_stem.is_empty() && !is_hash_stem(original_stem)
            })
        } else {
            None
        };

        if original_name.is_none() && !in_subfolder {
            continue;
        }

        let name = original_name.as_deref().unwrap_or(file_name);
        let extension = extension_for_path(path);
        let to = readable_asset_path_avoiding(vault_path, name, &extension, &taken);
        taken.insert(to.clone());
        renames.push(PlannedRename {
            from: asset_path.clone(),
            to,
        });
    }

    Ok(renames)
}

/// Files the operating system leaves in folders it has shown, which are not
/// attachments.
fn is_system_file(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        "thumbs.db" | "desktop.ini" | ".ds_store"
    )
}

/// Removes folders under `_attachments` that hold no attachments, such as
/// the old two-letter hash folders once tidied. Folders holding only system
/// files count as empty. The `_attachments` folder itself stays.
fn prune_empty_attachment_folders(vault_path: &Path) {
    fn prune(dir: &Path) -> bool {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return false;
        };
        let mut is_empty = true;
        let mut system_files = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(kind) if kind.is_dir() => {
                    if !prune(&path) || std::fs::remove_dir(&path).is_err() {
                        is_empty = false;
                    }
                }
                Ok(kind)
                    if kind.is_file() && is_system_file(&entry.file_name().to_string_lossy()) =>
                {
                    system_files.push(path);
                }
                _ => is_empty = false,
            }
        }
        if is_empty {
            for file in system_files {
                if std::fs::remove_file(&file).is_err() {
                    return false;
                }
            }
        }
        is_empty
    }

    prune(&vault_path.join(ATTACHMENTS_DIR_NAME));
}

/// Lists the files under the vault's attachment folder as asset paths, with
/// their sizes.
fn scan_attachment_files(vault_path: &Path) -> Vec<(String, u64)> {
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
fn register_untracked_attachment(
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
        let bytes = std::fs::read(&absolute_path).map_err(|e| {
            format!(
                "Failed to read attachment {}: {}",
                absolute_path.display(),
                e
            )
        })?;
        blake3::hash(&bytes).to_hex().to_string()
    };
    let extension = extension_for_path(&absolute_path);
    let original_name = absolute_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment")
        .to_string();

    upsert_attachment_record(
        conn,
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
        },
    )
}

/// Registers every file in the attachment folder the database does not
/// track yet. Returns their asset paths.
fn register_untracked_attachments(
    conn: &Connection,
    vault_path: &Path,
    disk_files: &[(String, u64)],
) -> Result<HashSet<String>, String> {
    let mut registered = HashSet::new();
    for (asset_path, size_bytes) in disk_files {
        // Leftovers from an interrupted write are not attachments.
        if asset_path.ends_with(".tmp") {
            continue;
        }

        let known: Option<String> = conn
            .query_row(
                "SELECT asset_path FROM attachments WHERE asset_path = ?1",
                params![asset_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query attachment metadata: {}", e))?;

        if known.is_none() {
            register_untracked_attachment(conn, vault_path, asset_path, *size_bytes)?;
            registered.insert(asset_path.clone());
        }
    }

    Ok(registered)
}

/// The original name of a missing attachment and, when a file with the same
/// content is in the vault, its asset path.
fn describe_missing(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let row: Option<(String, String, String, i64)> = conn
        .query_row(
            "SELECT hash, original_name, extension, size_bytes FROM attachments WHERE asset_path = ?1",
            params![asset_path],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to query attachment metadata: {}", e))?;

    let Some((hash, original_name, extension, size_bytes)) = row else {
        return Ok((None, None));
    };
    let found = find_identical_attachment(
        conn,
        vault_path,
        &hash,
        &extension,
        size_bytes.max(0) as u64,
        Some(asset_path),
    )?;
    // A hash name says nothing about the file; a readable one is worth showing.
    let original_name = Some(original_name).filter(|name| {
        let stem = Path::new(name)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        !is_hash_stem(stem)
    });

    Ok((original_name, found))
}

/// Looks up a missing attachment for the editor: its original name, and a
/// file with the same content to relink to.
pub fn describe_missing_attachment(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
) -> Result<MissingAttachmentInfo, String> {
    let asset_path = normalize_attachment_path(asset_path)
        .ok_or_else(|| format!("Not a vault attachment: {}", asset_path))?;
    register_untracked_attachments(conn, vault_path, &scan_attachment_files(vault_path))?;
    let (original_name, found_asset_path) = describe_missing(conn, vault_path, &asset_path)?;
    let found_absolute_path = found_asset_path
        .as_deref()
        .and_then(|found| path_from_asset_path(vault_path, found).ok())
        .map(|path| path.to_string_lossy().to_string());

    Ok(MissingAttachmentInfo {
        original_name,
        found_asset_path,
        found_absolute_path,
    })
}

/// Brings the database in line with the vault on disk and reports what is
/// missing or unused.
///
/// - Re-reads the attachment links of every shard in `markdown_paths`, so a
///   database created before attachments were tracked, or edits made outside
///   the app, are picked up.
/// - Drops references from shards under the vault that no longer exist.
/// - Registers files in the attachment folder that the database does not
///   know, so later cleanup can see them.
///
/// The database is shared by every vault, so references are counted only
/// from this vault's shards. Nothing on disk is changed.
pub fn reconcile_vault_attachments(
    conn: &Connection,
    vault_path: &Path,
    markdown_paths: &[String],
) -> Result<AttachmentReport, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start attachment reconciliation: {}", e))?;
    let mut report = AttachmentReport::default();
    let shard_paths: HashSet<&str> = markdown_paths.iter().map(String::as_str).collect();

    // Shards deleted or moved outside the app.
    let referencing_paths: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT DISTINCT file_path FROM attachment_references")
            .map_err(|e| format!("Failed to prepare attachment reference query: {}", e))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query attachment references: {}", e))?;
        rows.filter_map(Result::ok).collect()
    };
    for file_path in referencing_paths {
        if Path::new(&file_path).starts_with(vault_path)
            && !shard_paths.contains(file_path.as_str())
        {
            remove_references_for_markdown_file(&tx, &file_path)?;
            report.removed_shard_count += 1;
        }
    }

    // Files on disk the database does not know yet.
    prune_empty_attachment_folders(vault_path);
    let disk_files = scan_attachment_files(vault_path);
    let registered = register_untracked_attachments(&tx, vault_path, &disk_files)?;
    report.registered_count = registered.len();
    refresh_attachment_counts(&tx, &registered)?;

    // Current links from every shard.
    let mut shards_by_asset: HashMap<String, Vec<String>> = HashMap::new();
    let mut shard_contents = Vec::new();
    for shard_path in markdown_paths {
        let Ok(content) = std::fs::read_to_string(shard_path) else {
            continue;
        };
        sync_references_for_saved_markdown(&tx, shard_path, &content)?;

        let mut seen = HashSet::new();
        for reference in parse_attachment_references(&content) {
            if seen.insert(reference.asset_path.clone()) {
                shards_by_asset
                    .entry(reference.asset_path)
                    .or_default()
                    .push(shard_path.clone());
            }
        }
        shard_contents.push((shard_path.clone(), content));
    }
    report.external_files = find_external_files(vault_path, &shard_contents);
    report.tidy_renames = plan_tidy_renames(&tx, vault_path, &disk_files)?;

    let on_disk: HashSet<&str> = disk_files.iter().map(|(path, _)| path.as_str()).collect();
    report.file_count = disk_files.len();
    report.total_bytes = disk_files.iter().map(|(_, size)| size).sum();

    for (asset_path, size_bytes) in &disk_files {
        if shards_by_asset.contains_key(asset_path) {
            continue;
        }

        let unused_since: Option<i64> = tx
            .query_row(
                "SELECT gc_candidate_at FROM attachments WHERE asset_path = ?1",
                params![asset_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query attachment metadata: {}", e))?
            .flatten();

        report.unused.push(UnusedAttachment {
            asset_path: asset_path.clone(),
            size_bytes: *size_bytes,
            unused_since,
        });
    }

    for (asset_path, mut shards) in shards_by_asset {
        let exists = on_disk.contains(asset_path.as_str())
            || path_from_asset_path(vault_path, &asset_path).is_ok_and(|path| path.exists());
        if !exists {
            shards.sort();
            let (original_name, found_asset_path) = describe_missing(&tx, vault_path, &asset_path)?;
            report.missing.push(MissingAttachment {
                asset_path,
                shard_paths: shards,
                original_name,
                found_asset_path,
            });
        }
    }
    report
        .missing
        .sort_by(|a, b| a.asset_path.cmp(&b.asset_path));

    tx.commit()
        .map_err(|e| format!("Failed to save attachment reconciliation: {}", e))?;

    Ok(report)
}

/// Renames an attachment file and moves its database row and references to
/// the new path. Links in shards are rewritten by the caller.
pub fn rename_attachment(
    conn: &Connection,
    vault_path: &Path,
    from: &str,
    to: &str,
) -> Result<(), String> {
    let source = path_from_asset_path(vault_path, from)?;
    let destination = path_from_asset_path(vault_path, to)?;
    let attachments_dir = vault_path.join(ATTACHMENTS_DIR_NAME);
    if !source.starts_with(&attachments_dir) || !destination.starts_with(&attachments_dir) {
        return Err("Attachments can only be renamed inside the attachment folder.".into());
    }
    if !source.is_file() {
        return Err(format!("Attachment not found: {}", from));
    }
    if destination.exists() {
        return Err(format!("An attachment named {} already exists.", to));
    }

    let _write_guard = ATTACHMENT_WRITE_LOCK
        .lock()
        .map_err(|e| format!("Failed to lock attachment writes: {}", e))?;
    if let Some(parent) = destination.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    std::fs::rename(&source, &destination)
        .map_err(|e| format!("Failed to rename {}: {}", from, e))?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start attachment rename: {}", e))?;
    tx.execute(
        "INSERT OR IGNORE INTO attachments (asset_path, hash, original_name, extension, mime_type, size_bytes, created_at, updated_at, sync_status, ref_count, last_referenced_at, gc_candidate_at)
         SELECT ?2, hash, original_name, extension, mime_type, size_bytes, created_at, updated_at, sync_status, ref_count, last_referenced_at, gc_candidate_at
         FROM attachments WHERE asset_path = ?1",
        params![from, to],
    )
    .map_err(|e| format!("Failed to move attachment metadata: {}", e))?;
    tx.execute(
        "UPDATE OR IGNORE attachment_references SET asset_path = ?2 WHERE asset_path = ?1",
        params![from, to],
    )
    .map_err(|e| format!("Failed to move attachment references: {}", e))?;
    tx.execute(
        "DELETE FROM attachments WHERE asset_path = ?1",
        params![from],
    )
    .map_err(|e| format!("Failed to remove old attachment metadata: {}", e))?;
    tx.commit()
        .map_err(|e| format!("Failed to save attachment rename: {}", e))?;

    prune_empty_attachment_folders(vault_path);

    Ok(())
}

/// How long a file must stay unused before cleanup removes it, so a link
/// that is removed and soon restored (an undo, a cut and paste) keeps its
/// file.
pub const CLEANUP_GRACE_SECONDS: i64 = 7 * 24 * 60 * 60;

/// What cleanup did.
#[derive(Debug, Clone, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupResult {
    pub removed: Vec<String>,
    pub freed_bytes: u64,
    /// Requested files that were kept: linked again, too recently unused,
    /// or not removable.
    pub kept: Vec<String>,
}

/// Whether an unused file has been unused long enough to remove. Leftover
/// `.tmp` files from an interrupted write always qualify.
pub fn is_ready_for_cleanup(file: &UnusedAttachment, now: i64) -> bool {
    file.asset_path.ends_with(".tmp")
        || file
            .unused_since
            .is_some_and(|since| now - since >= CLEANUP_GRACE_SECONDS)
}

/// Moves the requested unused attachments to the trash with `remove`,
/// after re-checking the vault so that a file linked again since the
/// preview is never removed. Removes their database rows and any folder
/// left empty under `_attachments`.
pub fn clean_up_vault_attachments(
    conn: &Connection,
    vault_path: &Path,
    markdown_paths: &[String],
    asset_paths: &[String],
    now: i64,
    remove: impl Fn(&Path) -> Result<(), String>,
) -> Result<CleanupResult, String> {
    let report = reconcile_vault_attachments(conn, vault_path, markdown_paths)?;
    let ready: HashMap<&str, &UnusedAttachment> = report
        .unused
        .iter()
        .filter(|file| is_ready_for_cleanup(file, now))
        .map(|file| (file.asset_path.as_str(), file))
        .collect();
    let attachments_dir = vault_path.join(ATTACHMENTS_DIR_NAME);
    let mut result = CleanupResult::default();

    for asset_path in asset_paths {
        let Some(file) = ready.get(asset_path.as_str()) else {
            result.kept.push(asset_path.clone());
            continue;
        };
        let Ok(path) = path_from_asset_path(vault_path, asset_path) else {
            result.kept.push(asset_path.clone());
            continue;
        };
        if !path.starts_with(&attachments_dir) {
            result.kept.push(asset_path.clone());
            continue;
        }

        if let Err(error) = remove(&path) {
            eprintln!(
                "[Netherstone] Failed to remove attachment {}: {}",
                asset_path, error
            );
            result.kept.push(asset_path.clone());
            continue;
        }

        conn.execute(
            "DELETE FROM attachments WHERE asset_path = ?1 AND ref_count = 0",
            params![asset_path],
        )
        .map_err(|e| format!("Failed to forget removed attachment: {}", e))?;
        result.freed_bytes += file.size_bytes;
        result.removed.push(asset_path.clone());

        // Drop folders the removal emptied, such as old hash folders.
        let mut dir = path.parent();
        while let Some(current) = dir {
            if current == attachments_dir || !current.starts_with(&attachments_dir) {
                break;
            }
            if std::fs::remove_dir(current).is_err() {
                break;
            }
            dir = current.parent();
        }
    }

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    const USED_HASH: &str = "ab00000000000000000000000000000000000000000000000000000000000000";

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netherstone-attachments-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("_attachments/ab")).unwrap();
        std::fs::create_dir_all(dir.join("_attachments/cd")).unwrap();
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        dir
    }

    fn path_string(path: PathBuf) -> String {
        path.to_string_lossy().into_owned()
    }

    fn ref_count(conn: &Connection, asset_path: &str) -> i64 {
        conn.query_row(
            "SELECT ref_count FROM attachments WHERE asset_path = ?1",
            params![asset_path],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn reconcile_reports_missing_and_unused_and_repairs_references() {
        let vault = temp_vault("reconcile");
        let used = format!("_attachments/ab/{USED_HASH}.png");
        std::fs::write(vault.join(&used), b"png").unwrap();
        std::fs::write(vault.join("_attachments/cd/old.png"), b"old!").unwrap();

        let note = path_string(vault.join("note.md"));
        let nested = path_string(vault.join("sub").join("nested.md"));
        std::fs::write(&note, format!("![a]({used})\n")).unwrap();
        std::fs::write(
            &nested,
            "<img src=\"_attachments/ef/gone.png\" width=\"10\" />\n",
        )
        .unwrap();

        let conn = Connection::open_in_memory().unwrap();
        super::super::init_schema(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        // A shard deleted outside the app, and a shard in another vault that
        // links to the same attachment path.
        let deleted = path_string(vault.join("deleted.md"));
        let other_vault = std::env::temp_dir().join("netherstone-other-vault");
        let other = path_string(other_vault.join("other.md"));
        for file_path in [&deleted, &other] {
            sync_references_for_saved_markdown(&conn, file_path, "![x](_attachments/cd/old.png)\n")
                .unwrap();
        }
        // The other vault's file is not on this disk, so nothing registered it.
        upsert_attachment_record(
            &conn,
            &PersistedAttachment {
                asset_path: "_attachments/cd/old.png".into(),
                absolute_path: String::new(),
                hash: "h".into(),
                original_name: "old.png".into(),
                extension: "png".into(),
                mime_type: "image/png".into(),
                size_bytes: 4,
                sync_status: "syncable".into(),
            },
        )
        .unwrap();

        let report =
            reconcile_vault_attachments(&conn, &vault, &[note.clone(), nested.clone()]).unwrap();

        assert_eq!(report.file_count, 2);
        assert_eq!(report.total_bytes, 7);
        assert_eq!(report.removed_shard_count, 1);
        assert_eq!(report.registered_count, 1);
        assert_eq!(
            report.missing,
            vec![MissingAttachment {
                asset_path: "_attachments/ef/gone.png".into(),
                shard_paths: vec![nested.clone()],
                original_name: None,
                found_asset_path: None,
            }]
        );
        // Unused in this vault even though the other vault still links to it.
        assert_eq!(report.unused.len(), 1);
        assert_eq!(report.unused[0].asset_path, "_attachments/cd/old.png");
        assert_eq!(report.unused[0].size_bytes, 4);

        assert_eq!(ref_count(&conn, &used), 1);
        assert_eq!(ref_count(&conn, "_attachments/cd/old.png"), 1);
        let hash: String = conn
            .query_row(
                "SELECT hash FROM attachments WHERE asset_path = ?1",
                params![used],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(hash, USED_HASH);

        // A second run finds nothing new to repair.
        let again = reconcile_vault_attachments(&conn, &vault, &[note, nested]).unwrap();
        assert_eq!(again.removed_shard_count, 0);
        assert_eq!(again.registered_count, 0);
        assert_eq!(again.missing.len(), 1);

        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn a_link_to_a_missing_file_keeps_the_shard_other_links() {
        let vault = temp_vault("missing-link");
        let used = format!("_attachments/ab/{USED_HASH}.png");
        std::fs::write(vault.join(&used), b"png").unwrap();
        let note = path_string(vault.join("note.md"));

        let conn = Connection::open_in_memory().unwrap();
        super::super::init_schema(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

        sync_references_for_saved_markdown(
            &conn,
            &note,
            &format!("![gone](_attachments/zz/gone.png)\n\n![a]({used})\n"),
        )
        .unwrap();

        assert_eq!(ref_count(&conn, &used), 1);
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn picking_a_file_already_in_attachments_reuses_it() {
        let vault = temp_vault("pick-existing");
        let renamed = vault.join("_attachments/ab/My diagram.png");
        std::fs::write(&renamed, b"png").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        super::super::init_schema(&conn).unwrap();

        let attachment = persist_attachment_file(&conn, &vault, &renamed).unwrap();
        assert_eq!(attachment.asset_path, "_attachments/ab/My diagram.png");

        let files: Vec<_> = scan_attachment_files(&vault)
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        assert_eq!(files, ["_attachments/ab/My diagram.png"]);
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn new_attachments_keep_their_name_and_identical_files_are_shared() {
        let vault = temp_vault("readable");
        let conn = Connection::open_in_memory().unwrap();
        super::super::init_schema(&conn).unwrap();

        let first = persist_attachment_bytes(&conn, &vault, "Screen: shot.png", b"one").unwrap();
        assert_eq!(first.asset_path, "_attachments/Screen- shot.png");

        let same = persist_attachment_bytes(&conn, &vault, "copy.png", b"one").unwrap();
        assert_eq!(same.asset_path, first.asset_path);
        assert_eq!(same.original_name, "Screen: shot.png");

        let other = persist_attachment_bytes(&conn, &vault, "Screen: shot.png", b"two").unwrap();
        assert_eq!(other.asset_path, "_attachments/Screen- shot-1.png");

        let reserved = persist_attachment_bytes(&conn, &vault, "CON.txt", b"three").unwrap();
        assert_eq!(reserved.asset_path, "_attachments/CON-file.txt");

        // A file stored under its hash before names were readable is reused.
        let legacy_hash = blake3::hash(b"legacy").to_hex().to_string();
        let legacy = attachment_asset_path(&legacy_hash, "png");
        std::fs::create_dir_all(vault.join(&legacy).parent().unwrap()).unwrap();
        std::fs::write(vault.join(&legacy), b"legacy").unwrap();
        let reused = persist_attachment_bytes(&conn, &vault, "legacy.png", b"legacy").unwrap();
        assert_eq!(reused.asset_path, legacy);

        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn a_renamed_attachment_is_found_by_its_content() {
        let vault = temp_vault("renamed");
        let conn = Connection::open_in_memory().unwrap();
        super::super::init_schema(&conn).unwrap();

        let attachment = persist_attachment_bytes(&conn, &vault, "Diagram.png", b"png").unwrap();
        let note = path_string(vault.join("note.md"));
        std::fs::write(&note, format!("![d](<{}>)\n", attachment.asset_path)).unwrap();
        std::fs::rename(
            vault.join(&attachment.asset_path),
            vault.join("_attachments/cd/Renamed.png"),
        )
        .unwrap();

        let report = reconcile_vault_attachments(&conn, &vault, &[note]).unwrap();
        assert_eq!(report.missing.len(), 1);
        assert_eq!(
            report.missing[0].original_name.as_deref(),
            Some("Diagram.png")
        );
        assert_eq!(
            report.missing[0].found_asset_path.as_deref(),
            Some("_attachments/cd/Renamed.png")
        );

        let info = describe_missing_attachment(&conn, &vault, &attachment.asset_path).unwrap();
        assert_eq!(
            info.found_asset_path.as_deref(),
            Some("_attachments/cd/Renamed.png")
        );
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn cleanup_removes_only_files_unused_past_the_grace_period() {
        let vault = temp_vault("cleanup");
        let conn = Connection::open_in_memory().unwrap();
        super::super::init_schema(&conn).unwrap();

        let kept = persist_attachment_bytes(&conn, &vault, "kept.png", b"kept").unwrap();
        let old = persist_attachment_bytes(&conn, &vault, "old.png", b"old!").unwrap();
        let recent = persist_attachment_bytes(&conn, &vault, "recent.png", b"new").unwrap();
        std::fs::write(vault.join("_attachments/cd/leftover.png.tmp"), b"x").unwrap();
        let note = path_string(vault.join("note.md"));
        std::fs::write(&note, format!("![k]({})\n", kept.asset_path)).unwrap();

        // Start the clock: both unused files become cleanup candidates now.
        let shards = vec![note.clone()];
        reconcile_vault_attachments(&conn, &vault, &shards).unwrap();
        let now = now_unix_seconds();
        conn.execute(
            "UPDATE attachments SET gc_candidate_at = ?1 WHERE asset_path = ?2",
            params![now - CLEANUP_GRACE_SECONDS - 1, old.asset_path],
        )
        .unwrap();

        let requested = vec![
            kept.asset_path.clone(),
            old.asset_path.clone(),
            recent.asset_path.clone(),
            "_attachments/cd/leftover.png.tmp".to_string(),
        ];
        let result = clean_up_vault_attachments(&conn, &vault, &shards, &requested, now, |path| {
            std::fs::remove_file(path).map_err(|e| e.to_string())
        })
        .unwrap();

        assert_eq!(
            result.removed,
            vec![
                old.asset_path.clone(),
                "_attachments/cd/leftover.png.tmp".to_string()
            ]
        );
        assert_eq!(result.freed_bytes, 5);
        assert_eq!(
            result.kept,
            vec![kept.asset_path.clone(), recent.asset_path.clone()]
        );
        assert!(vault.join(&kept.asset_path).is_file());
        assert!(vault.join(&recent.asset_path).is_file());
        assert!(!vault.join(&old.asset_path).exists());
        // The emptied hash folder is gone; the attachment root stays.
        assert!(!vault.join("_attachments/cd").exists());
        assert!(vault.join("_attachments").is_dir());

        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn report_lists_external_files_and_tidy_renames() {
        let vault = temp_vault("external");
        let conn = Connection::open_in_memory().unwrap();
        super::super::init_schema(&conn).unwrap();

        // A file elsewhere in the vault, one outside it, and one hash-named.
        std::fs::create_dir_all(vault.join("images")).unwrap();
        std::fs::write(vault.join("images/a b.png"), b"a").unwrap();
        let outside =
            std::env::temp_dir().join(format!("netherstone-outside-{}.pdf", std::process::id()));
        std::fs::write(&outside, b"pdf").unwrap();
        let hash = blake3::hash(b"legacy").to_hex().to_string();
        let legacy = attachment_asset_path(&hash, "png");
        std::fs::create_dir_all(vault.join(&legacy).parent().unwrap()).unwrap();
        std::fs::write(vault.join(&legacy), b"legacy").unwrap();
        upsert_attachment_record(
            &conn,
            &PersistedAttachment {
                asset_path: legacy.clone(),
                absolute_path: String::new(),
                hash: hash.clone(),
                original_name: "Diagram.png".into(),
                extension: "png".into(),
                mime_type: "image/png".into(),
                size_bytes: 6,
                sync_status: "syncable".into(),
            },
        )
        .unwrap();
        std::fs::write(vault.join("_attachments/Diagram.png"), b"taken").unwrap();
        // A readable file left in a hash folder, and a hash-named file whose
        // original name is unknown.
        std::fs::create_dir_all(vault.join("_attachments/0c")).unwrap();
        std::fs::write(vault.join("_attachments/0c/My diagram.png"), b"mine").unwrap();
        let unknown = format!("_attachments/0d/{}.pdf", blake3::hash(b"unknown").to_hex());
        std::fs::create_dir_all(vault.join("_attachments/0d")).unwrap();
        std::fs::write(vault.join(&unknown), b"unknown").unwrap();

        let note = path_string(vault.join("sub").join("note.md"));
        let outside_link = outside.to_string_lossy().into_owned();
        std::fs::write(
            &note,
            format!(
                "![a](<../images/a b.png>)\n\n![b](../images/a%20b.png)\n\n\
                 <file name=\"x\" src=\"{outside_link}\" />\n\n\
                 [web](https://example.com/a.png) [note](other.md) ![l]({legacy})\n"
            ),
        )
        .unwrap();

        // Folders left empty, or holding only system files.
        std::fs::create_dir_all(vault.join("_attachments/1a")).unwrap();
        std::fs::create_dir_all(vault.join("_attachments/1b/nested")).unwrap();
        std::fs::write(vault.join("_attachments/1b/Thumbs.db"), b"x").unwrap();

        let report = reconcile_vault_attachments(&conn, &vault, &[note.clone()]).unwrap();
        assert!(!vault.join("_attachments/1a").exists());
        assert!(!vault.join("_attachments/1b").exists());

        let in_vault = report
            .external_files
            .iter()
            .find(|file| file.inside_vault)
            .unwrap();
        assert!(in_vault.absolute_path.ends_with("a b.png"));
        assert_eq!(
            in_vault
                .uses
                .iter()
                .map(|u| u.link.as_str())
                .collect::<Vec<_>>(),
            ["../images/a b.png", "../images/a%20b.png"]
        );
        let device = report
            .external_files
            .iter()
            .find(|file| !file.inside_vault)
            .unwrap();
        assert_eq!(device.uses[0].link, outside_link);
        assert_eq!(report.external_files.len(), 2);

        let mut renames = report.tidy_renames.clone();
        renames.sort_by(|a, b| a.from.cmp(&b.from));
        let mut expected = vec![
            PlannedRename {
                from: legacy.clone(),
                to: "_attachments/Diagram-1.png".into(),
            },
            PlannedRename {
                from: "_attachments/0c/My diagram.png".into(),
                to: "_attachments/My diagram.png".into(),
            },
            PlannedRename {
                from: unknown.clone(),
                to: unknown.replacen("0d/", "", 1),
            },
        ];
        expected.sort_by(|a, b| a.from.cmp(&b.from));
        assert_eq!(renames, expected);

        rename_attachment(&conn, &vault, &legacy, "_attachments/Diagram-1.png").unwrap();
        assert!(vault.join("_attachments/Diagram-1.png").is_file());
        assert!(!vault.join(&legacy).parent().unwrap().exists());
        let moved: String = conn
            .query_row(
                "SELECT original_name FROM attachments WHERE asset_path = ?1",
                params!["_attachments/Diagram-1.png"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(moved, "Diagram.png");

        std::fs::remove_file(&outside).unwrap();
        std::fs::remove_dir_all(&vault).unwrap();
    }
}
