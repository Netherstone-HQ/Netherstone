//! Search and the index's views of the vault: tags, writing, charts, links.

use crate::vault_access::{self, in_open_vault, open_vault_only};
use crate::{db, sync};
use serde::Serialize;
use std::path::Path;

/// Why a search failed, so the search dialog can say what went wrong.
#[derive(Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SearchError {
    /// The search index couldn't be opened.
    Unavailable,
    /// The index opened, but the search itself failed.
    Failed,
}

#[tauri::command(async)]
pub(crate) fn search_files(
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

#[tauri::command(async)]
pub(crate) fn get_tagged_files() -> Result<Vec<db::queries::TaggedFile>, String> {
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::queries::get_tagged_files(conn, &vault).map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
pub(crate) fn get_writing_log(vault_path: String) -> Result<db::data::WritingLog, String> {
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
pub(crate) fn get_charts() -> Result<Vec<db::data::ShardChart>, String> {
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| db::data::get_charts(conn, &vault))
}

#[tauri::command(async)]
pub(crate) fn get_broken_links() -> Result<Vec<db::data::BrokenLink>, String> {
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| db::data::get_broken_links(conn, &vault))
}

#[tauri::command(async)]
pub(crate) fn get_backlinks(file_path: String) -> Result<Vec<db::queries::Backlink>, String> {
    in_open_vault(&file_path)?;
    let vault = vault_access::get().open_vault()?;
    let db = db::Database::new()?;

    db.with_connection(|conn| {
        db::queries::get_backlinks(conn, &vault, &file_path)
            .map_err(|_e| rusqlite::Error::InvalidQuery)
    })
}

#[tauri::command(async)]
pub(crate) fn get_file_metadata(
    file_path: String,
) -> Result<Option<db::queries::FileMetadata>, String> {
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
