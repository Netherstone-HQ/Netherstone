//! Shards and drawings: reading, saving, caching, moving and querying them.

pub mod cache;
pub mod drawings;
pub mod files;
pub mod paths;
pub mod queries;

use crate::{db, locks, vault};
use std::path::Path;

pub(crate) fn hash_markdown_content(content: &str) -> String {
    blake3::hash(content.as_bytes()).to_hex().to_string()
}

/// Writes a shard of `vault` while `writes.lock` is held, then points its
/// attachment references at what it now links to.
pub(crate) fn write_shard(
    writes: &locks::VaultWrites,
    vault: &Path,
    file_path: &str,
    content: &str,
) -> Result<(), String> {
    vault::write_atomically(writes, Path::new(file_path), content.as_bytes())?;

    let synced = db::open_connection().and_then(|conn| {
        db::attachments::sync_references_for_saved_markdown(&conn, vault, file_path, content)
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
pub(crate) fn write_markdown_file_if_unchanged(
    vault: &Path,
    file_path: &str,
    content: &str,
    expected: Option<&str>,
) -> Result<Option<String>, String> {
    let writes = locks::vault_writes()?;
    let previous = std::fs::read(file_path).ok();
    if is_changed(previous.as_deref(), expected) {
        return Err(CHANGED_ON_DISK.to_string());
    }
    write_shard(&writes, vault, file_path, content)?;
    Ok(previous.and_then(|bytes| String::from_utf8(bytes).ok()))
}

/// What a save, or applying a change, returns when the shard or drawing
/// changed outside the app.
pub(crate) const CHANGED_ON_DISK: &str = "The shard changed on disk";

/// True when the file was there (`on_disk`) and doesn't hold `expected`.
pub(crate) fn is_changed(on_disk: Option<&[u8]>, expected: Option<&str>) -> bool {
    matches!((on_disk, expected), (Some(bytes), Some(expected)) if bytes != expected.as_bytes())
}
