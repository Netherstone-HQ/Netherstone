//! Keeping the search index up to date with a vault while the tools use it,
//! with the app closed too: one pass over the vault when it starts, then
//! only what changes, as the OS reports it.

use super::Vault;
use crate::watcher::FolderTracker;
use notify_debouncer_mini::{DebounceEventResult, new_debouncer, notify::RecursiveMode};
use std::path::Path;
use std::time::Duration;

/// Keeps the index up to date until dropped.
pub struct Watch {
    _watcher: notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
}

/// How long changes settle before they're indexed, as the app's watcher waits.
const SETTLE: Duration = Duration::from_millis(500);

fn log(result: Result<(), String>) {
    if let Err(error) = result {
        eprintln!("[Netherstone] Couldn't index a change: {}", error);
    }
}

/// Indexes what changed at `path`: a shard written or gone, or a folder that
/// appeared (its shards) or went (everything that was in it).
fn index_change(conn: &rusqlite::Connection, root: &Path, folders: &mut FolderTracker, path: &Path) {
    if crate::vault::is_markdown_path(path) {
        log(if path.is_file() {
            crate::db::indexer::index_file_if_changed(conn, root, path).map(|_| ())
        } else {
            crate::db::indexer::forget_path(conn, root, path).map(|_| ())
        });
    } else if folders.observe(path) {
        if path.is_dir() {
            let mut shards = Vec::new();
            for node in &crate::vault::scan_dir(path) {
                crate::vault::collect_file_paths(node, &mut shards);
            }
            for shard in shards {
                log(crate::db::indexer::index_file_if_changed(conn, root, Path::new(&shard)).map(|_| ()));
            }
        } else {
            log(crate::db::indexer::forget_path(conn, root, path).map(|_| ()));
        }
    }
}

/// Indexes the shards of `vault` that changed since it was last indexed,
/// then watches it and indexes each change as it lands.
pub fn keep_indexed(vault: &Vault) -> Result<Watch, String> {
    let root = vault.root.clone();
    let indexed = crate::db::indexer::index_vault(&crate::db::open_connection()?, &root)?;
    eprintln!(
        "[Netherstone] Indexed {}: {} changed, {} unchanged, {} failed",
        root.display(),
        indexed.indexed,
        indexed.skipped,
        indexed.errors
    );

    let mut folders = FolderTracker::new(&root);
    let watched = root.clone();
    let mut watcher = new_debouncer(SETTLE, move |result: DebounceEventResult| {
        let conn = match crate::db::open_connection() {
            Ok(conn) => conn,
            Err(error) => return eprintln!("[Netherstone] Couldn't open the index: {}", error),
        };
        match result {
            Ok(events) => {
                for event in events.iter().filter(|event| crate::vault::is_scanned_path(&root, &event.path)) {
                    index_change(&conn, &root, &mut folders, &event.path);
                }
            }
            // The OS dropped events: go over the whole vault again.
            Err(error) => {
                eprintln!("[Netherstone] Vault watcher error, indexing again: {}", error);
                folders = FolderTracker::new(&root);
                log(crate::db::indexer::index_vault(&conn, &root).map(|_| ()));
            }
        }
    })
    .map_err(|e| e.to_string())?;
    watcher
        .watcher()
        .watch(&watched, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;
    Ok(Watch { _watcher: watcher })
}
