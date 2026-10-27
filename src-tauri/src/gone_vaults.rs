//! Vaults whose folder is gone: deleted, or moved and not opened from its
//! new place yet. When the app starts it forgets what it keeps for them and
//! can make again, like their search index, thumbnails and place in Settings
//! (`forget`). Their history, and the writing they logged, can't be made
//! again, so they stay until the person deletes them in Settings
//! (`histories`, `delete_history`).

use crate::db;
use crate::sync::state::{self, VaultSyncRecord};
use serde::Serialize;
use std::path::{Path, PathBuf};

/// Whether `path` is gone from a folder that's still there. A vault on a
/// drive that's unplugged, or a share that's offline, isn't gone: the folder
/// it was in is missing too.
pub fn is_gone(path: &Path) -> bool {
    path.try_exists().is_ok_and(|exists| !exists)
        && path
            .parent()
            .is_some_and(|parent| parent.try_exists().is_ok_and(|exists| exists))
}

/// Every vault the database holds something for: the ones the app opened,
/// and any indexed before it kept that list.
fn known_vaults(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<PathBuf>> {
    let mut stmt = conn.prepare(
        "SELECT path FROM vaults
         UNION SELECT vault_path FROM files
         UNION SELECT vault_path FROM attachments",
    )?;
    stmt.query_map([], |row| row.get::<_, String>(0).map(PathBuf::from))?
        .collect()
}

/// Forgets what the app keeps for the vault at `vault_path` and can make
/// again: its search index, attachments, cached shards, thumbnails, and its
/// place among the vaults opened, which Settings and AI apps list.
fn forget_vault(conn: &rusqlite::Connection, vault_path: &Path) -> Result<(), String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    db::indexer::forget_path(&tx, vault_path, vault_path)?;
    db::attachments::forget_vault_attachments(&tx, vault_path).map_err(|e| e.to_string())?;
    db::ast_cache::prune_stale_ast_cache_for_vault(&tx, &vault_path.to_string_lossy(), &[])?;
    db::settings::forget_vault(&tx, vault_path).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let thumbnails = db::gallery::thumbnail_folder(vault_path)?;
    match std::fs::remove_dir_all(&thumbnails) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("Couldn't remove {}: {}", thumbnails.display(), error))
        }
        _ => Ok(()),
    }
}

/// Forgets the vaults whose folder is gone, of the ones the database holds
/// something for and `also`, and returns them.
pub fn forget(also: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let conn = db::open_connection()?;
    let mut vaults = known_vaults(&conn).map_err(|e| e.to_string())?;
    vaults.extend(also.iter().cloned());
    vaults.sort();
    vaults.dedup();

    let mut gone = Vec::new();
    for vault in vaults.into_iter().filter(|vault| is_gone(vault)) {
        match forget_vault(&conn, &vault) {
            Ok(()) => gone.push(vault),
            Err(error) => eprintln!("[Netherstone] Couldn't forget {}: {}", vault.display(), error),
        }
    }
    Ok(gone)
}

/// The history of a vault whose folder is gone.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GoneHistory {
    pub vault_id: String,
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
}

/// The bytes the files in `dir` take, its folders' included. Links aren't
/// followed.
fn size_of(dir: &Path) -> u64 {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter_map(|entry| Some((entry.path(), entry.metadata().ok()?)))
        .map(|(path, metadata)| if metadata.is_dir() { size_of(&path) } else { metadata.len() })
        .sum()
}

fn gone_history(sync_root: &Path, record: VaultSyncRecord) -> GoneHistory {
    let path = Path::new(&record.vault_path);
    GoneHistory {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| record.vault_path.clone()),
        size_bytes: size_of(&state::vault_dir(sync_root, &record.vault_id)),
        vault_id: record.vault_id,
        path: record.vault_path,
    }
}

/// The histories of the vaults whose folder is gone, the biggest first.
pub fn histories(sync_root: &Path) -> Vec<GoneHistory> {
    let mut histories: Vec<_> = state::records_of_gone_vaults(sync_root)
        .into_iter()
        .map(|record| gone_history(sync_root, record))
        .collect();
    histories.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then_with(|| a.name.cmp(&b.name)));
    histories
}

/// Moves the history kept as `vault_id` to the trash with `trash`, once it's
/// checked again that its vault is gone. The writing its vault logged goes
/// too, unless another vault is in its folder now. Returns the bytes freed.
pub fn delete_history(
    sync_root: &Path,
    vault_id: &str,
    trash: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<u64, String> {
    let _history = crate::locks::history(sync_root)?;
    let record = state::record_of_gone_vault(sync_root, vault_id)?
        .ok_or("That vault's folder is there again, so its history stays")?;
    let history = gone_history(sync_root, record);
    trash(&state::vault_dir(sync_root, vault_id))?;

    let folder = Path::new(&history.path);
    if is_gone(folder) {
        db::data::forget_writing_log(&db::open_connection()?, folder).map_err(|e| e.to_string())?;
    }
    Ok(history.size_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_is_gone_only_from_a_folder_still_there() {
        let dir = state::tests::temp_dir("gone-vaults-is-gone");
        let vault = dir.join("Vault");
        std::fs::create_dir_all(&vault).unwrap();
        assert!(!is_gone(&vault));
        std::fs::remove_dir_all(&vault).unwrap();
        assert!(is_gone(&vault));
        // Its drive or share is missing, not the vault.
        assert!(!is_gone(&dir.join("Unplugged/Vault")));
    }

    #[test]
    fn forgetting_a_vault_leaves_the_others() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        let (gone, kept) = (Path::new("/v/Gone"), Path::new("/v/Kept"));
        for vault in [gone, kept] {
            let vault_text = vault.to_string_lossy();
            db::settings::record_opened_vault(&conn, vault).unwrap();
            conn.execute(
                "INSERT INTO files (vault_path, path, name, last_modified, last_indexed, content_hash)
                 VALUES (?1, ?1 || '/a.md', 'a.md', 0, 0, '')",
                [&vault_text],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO fts_search (rowid, path, name, content)
                 SELECT id, path, name, 'text' FROM files WHERE vault_path = ?1",
                [&vault_text],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tags (file_id, tag) SELECT id, 'tag' FROM files WHERE vault_path = ?1",
                [&vault_text],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO attachments (vault_path, asset_path, hash, original_name, extension, mime_type, size_bytes, sync_status)
                 VALUES (?1, '_attachments/a.png', 'h', 'a.png', 'png', 'image/png', 1, 'syncable')",
                [&vault_text],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO ast_cache_index (file_path, content_hash, cache_version) VALUES (?1 || '/a.md', 'h', 1)",
                [&vault_text],
            )
            .unwrap();
        }

        forget_vault(&conn, gone).unwrap();

        for table in ["files", "fts_search", "tags", "attachments", "ast_cache_index", "vaults"] {
            let rows: i64 =
                conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap();
            assert_eq!(rows, 1, "{table}");
        }
        assert_eq!(known_vaults(&conn).unwrap(), [kept]);
    }

    #[test]
    fn histories_of_gone_vaults_are_listed_and_trashed_on_request() {
        let dir = state::tests::temp_dir("gone-vaults-history");
        let sync_root = dir.join("sync");
        let (kept, deleted, replaced) = (dir.join("Kept"), dir.join("Deleted"), dir.join("Replaced"));
        let mut ids = Vec::new();
        for vault in [&kept, &deleted, &replaced] {
            std::fs::create_dir_all(vault).unwrap();
            let record = state::load_or_create_record(&sync_root, vault).unwrap();
            std::fs::write(state::vault_dir(&sync_root, &record.vault_id).join("pack"), b"12345").unwrap();
            ids.push(record.vault_id);
        }
        std::fs::remove_dir_all(&deleted).unwrap();
        // A new vault made where an old one was.
        std::fs::remove_dir_all(replaced.join(state::VAULT_META_DIR)).unwrap();
        state::load_or_create_record(&sync_root, &replaced).unwrap();

        let listed = histories(&sync_root);
        let listed_ids: Vec<_> = listed.iter().map(|history| history.vault_id.as_str()).collect();
        assert_eq!(listed.len(), 2, "{listed:?}");
        assert!(listed_ids.contains(&ids[1].as_str()) && listed_ids.contains(&ids[2].as_str()));
        assert!(listed.iter().all(|history| history.size_bytes >= 5));

        let mut trashed = Vec::new();
        let freed = delete_history(&sync_root, &ids[1], |path| {
            trashed.push(path.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert!(freed >= 5);
        assert_eq!(trashed, [state::vault_dir(&sync_root, &ids[1])]);

        // A vault still in its folder keeps its history.
        assert!(delete_history(&sync_root, &ids[0], |_| panic!("trashed a kept vault")).is_err());
        assert!(delete_history(&sync_root, "../elsewhere", |_| panic!("left the sync folder")).is_err());
    }
}
