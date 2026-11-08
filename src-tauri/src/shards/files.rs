//! Reading and saving shards.

use super::cache::AST_CACHE_VERSION;
use super::{hash_markdown_content, write_markdown_file_if_unchanged, write_shard};
use crate::vault_access::{self, in_open_vault};
use crate::{db, locks, vault};
use serde::Serialize;
use std::path::Path;

fn read_markdown_from_disk(file_path: &str) -> Result<String, String> {
    std::fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read file {}: {}", file_path, e))
}

fn ensure_markdown_path(path: &Path) -> Result<(), String> {
    if vault::is_markdown_path(path) {
        Ok(())
    } else {
        Err(format!("Not a shard: {}", path.display()))
    }
}

#[derive(Debug, Serialize)]
pub(crate) struct OpenMarkdownFileResult {
    file_path: String,
    markdown: String,
    content_hash: String,
    cache_hit: bool,
    plate_value: Option<serde_json::Value>,
}

#[tauri::command(async)]
pub(crate) fn read_markdown_file(file_path: String) -> Result<String, String> {
    in_open_vault(&file_path)?;
    ensure_markdown_path(Path::new(&file_path))?;
    read_markdown_from_disk(&file_path)
}

#[tauri::command(async)]
pub(crate) fn open_markdown_file(file_path: String) -> Result<OpenMarkdownFileResult, String> {
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

/// Saves a shard. `record_writing` is set by saves of what you type in the
/// editor, which the Data page counts as writing on this device.
/// `expected_content` is the text the app last read or wrote; if the file now
/// holds something else, it changed outside the app and the save is refused
/// rather than write over it.
#[tauri::command(async)]
pub(crate) fn save_markdown_file(
    file_path: String,
    content: String,
    record_writing: Option<bool>,
    expected_content: Option<String>,
) -> Result<(), String> {
    in_open_vault(&file_path)?;
    let vault = vault_access::get().open_vault()?;
    save_shard(
        &vault,
        &file_path,
        &content,
        record_writing == Some(true),
        expected_content.as_deref(),
    )
}

fn save_shard(
    vault: &Path,
    file_path: &str,
    content: &str,
    record_writing: bool,
    expected: Option<&str>,
) -> Result<(), String> {
    ensure_markdown_path(Path::new(file_path))?;
    let previous = write_markdown_file_if_unchanged(vault, file_path, content, expected)?;
    if record_writing {
        record_writing_after_save(file_path, content, previous);
    }
    Ok(())
}

/// Logs the words written today. The first save of the day also keeps the
/// words the shard started with, `previous`. A failure only costs the count.
fn record_writing_after_save(file_path: &str, content: &str, previous: Option<String>) {
    let result = db::open_connection().and_then(|conn| {
        db::data::record_writing(&conn, &db::data::local_today(), file_path, content, || {
            previous
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
pub(crate) fn append_markdown_to_file(file_path: String, markdown: String) -> Result<(), String> {
    in_open_vault(&file_path)?;
    ensure_markdown_path(Path::new(&file_path))?;
    let vault = vault_access::get().open_vault()?;
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

    write_shard(&writes, &vault, &file_path, &content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shards::CHANGED_ON_DISK;

    #[test]
    fn save_refuses_to_write_over_an_outside_change() {
        let dir = std::env::temp_dir().join(format!("netherstone-save-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shard = dir.join("Note.md");
        let path = shard.to_string_lossy().into_owned();
        std::fs::write(&shard, "opened").unwrap();

        save_shard(&dir, &path, "typed", false, Some("opened")).unwrap();
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "typed");

        std::fs::write(&shard, "outside").unwrap();
        assert_eq!(
            save_shard(&dir, &path, "typed more", false, Some("typed")),
            Err(CHANGED_ON_DISK.to_string())
        );
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "outside");

        // Other saves, and a shard that was deleted, are written as before.
        save_shard(&dir, &path, "renamed", false, None).unwrap();
        std::fs::remove_file(&shard).unwrap();
        save_shard(&dir, &path, "again", false, Some("renamed")).unwrap();
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "again");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_save_returns_the_text_it_replaced_and_only_writes_shards() {
        let dir = std::env::temp_dir().join(format!("netherstone-previous-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let shard = dir.join("Note.md").to_string_lossy().into_owned();

        assert_eq!(
            write_markdown_file_if_unchanged(&dir, &shard, "first", None),
            Ok(None)
        );
        assert_eq!(
            write_markdown_file_if_unchanged(&dir, &shard, "second", Some("first")),
            Ok(Some("first".to_string()))
        );
        let script = dir.join("run.sh").to_string_lossy().into_owned();
        let refused = save_shard(&dir, &script, "echo hi", false, None);
        let script_written = Path::new(&script).exists();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(refused.is_err());
        assert!(!script_written);
    }
}
