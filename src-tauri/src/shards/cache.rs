//! The editor tree cached for each shard.

use super::hash_markdown_content;
use crate::{db, export, vault_access};
use std::path::Path;

// Bump whenever the persisted Plate value shape changes, so older cached
// trees are dropped.
pub(crate) const AST_CACHE_VERSION: i64 = 4;

/// Caches a shard's editor tree. A shard's cache is written after the app
/// leaves it, maybe on another vault by then, so any vault may, not only the
/// open one.
#[tauri::command(async)]
pub(crate) fn upsert_ast_cache(
    vault_path: String,
    file_path: String,
    markdown: String,
    plate_value: serde_json::Value,
) -> Result<(), String> {
    write_ast_cache(&vault_path, &file_path, &markdown, |conn, content_hash| {
        db::ast_cache::upsert_ast_cache(
            conn,
            &file_path,
            content_hash,
            AST_CACHE_VERSION,
            &plate_value,
        )
    })
}

/// [`upsert_ast_cache`] for an entry the markdown worker made: the body is
/// the markdown's bytes, then the tree as JSON. The vault and shard come
/// URI-encoded in `x-vault-path` and `x-file-path`, and where the markdown
/// ends in `x-markdown-bytes`.
#[tauri::command(async)]
pub(crate) fn write_shard_cache(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let missing = |what: &str| format!("The cache entry is missing its {}.", what);
    let vault_path = export::header(&request, "x-vault-path").ok_or_else(|| missing("vault"))?;
    let file_path = export::header(&request, "x-file-path").ok_or_else(|| missing("shard"))?;
    let markdown_bytes = export::header(&request, "x-markdown-bytes");
    let (markdown, tree) = split_shard_cache(export::raw_body(&request)?, markdown_bytes)?;

    write_ast_cache(&vault_path, &file_path, markdown, |conn, content_hash| {
        db::ast_cache::upsert_ast_cache_json(
            conn,
            &file_path,
            content_hash,
            AST_CACHE_VERSION,
            tree,
        )
    })
}

/// A cache entry's markdown and tree, split where the markdown ends.
fn split_shard_cache(body: &[u8], markdown_bytes: Option<String>) -> Result<(&str, &str), String> {
    let (markdown, tree) = markdown_bytes
        .and_then(|bytes| bytes.parse().ok())
        .and_then(|bytes| body.split_at_checked(bytes))
        .ok_or("The cache entry is missing its markdown.")?;
    let text = |bytes| std::str::from_utf8(bytes).map_err(|e| e.to_string());
    Ok((text(markdown)?, text(tree)?))
}

fn write_ast_cache(
    vault_path: &str,
    file_path: &str,
    markdown: &str,
    write: impl FnOnce(&rusqlite::Connection, &str) -> Result<(), String>,
) -> Result<(), String> {
    vault_access::get().check_path_in_known_vault(Path::new(vault_path), Path::new(file_path))?;
    let conn = db::open_connection()?;
    write(&conn, &hash_markdown_content(markdown)).inspect_err(|error| {
        eprintln!(
            "[Netherstone] AST cache write failed path={} error={}",
            file_path, error
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_a_cache_entry_where_its_markdown_ends() {
        let body = "Héllo\n[1]".as_bytes();
        assert_eq!(
            split_shard_cache(body, Some("7".into())),
            Ok(("Héllo\n", "[1]"))
        );
        assert!(split_shard_cache(body, None).is_err());
        assert!(split_shard_cache(body, Some("99".into())).is_err());
        assert!(split_shard_cache(body, Some("x".into())).is_err());
        // Inside the two bytes of "é".
        assert!(split_shard_cache(body, Some("2".into())).is_err());
    }
}
