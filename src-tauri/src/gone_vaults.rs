//! Vaults whose folder is gone: deleted, or moved and not opened from its
//! new place yet. When the app starts it forgets what it keeps for them and
//! can make again, like their search index, thumbnails and place in Settings
//! (`forget`). Their history, and the writing they logged, can't be made
//! again, so they stay until the person deletes them in Settings
//! (`histories`, `delete_history`).

use crate::db;
use crate::sync::state::{self, VaultSyncRecord};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// The id the system gives the drive `path` is on: its device on macOS and
/// Linux, its volume's serial number on Windows.
pub fn drive_of(path: &Path) -> Option<u64> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(path).ok().map(|metadata| metadata.dev())
    }
    #[cfg(windows)]
    {
        let handle = winapi_util::Handle::from_path_any(path).ok()?;
        winapi_util::file::information(&handle).ok().map(|info| info.volume_serial_number())
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
        None
    }
}

/// Whether the vault at `path`, last opened on `drive`, is gone: the folder
/// it was in is still there, on that drive, without it. A vault on a drive
/// that's unplugged or a share that's offline isn't gone: the folder it was
/// in is missing too, or, where the drive was mounted on a folder that stays
/// (like Linux's `/mnt` mounts or Windows folder mounts), is on another drive.
/// With its drive unknown, as for a vault opened before drives were kept,
/// the folder it was in being there is all there is to go on.
pub fn is_gone(path: &Path, drive: Option<u64>) -> bool {
    let Some(parent) = path.parent() else {
        return false;
    };
    path.try_exists().is_ok_and(|exists| !exists)
        && parent.try_exists().is_ok_and(|exists| exists)
        && drive.is_none_or(|drive| drive_of(parent) == Some(drive))
}

/// The drive each vault the app opened was on, where it's known.
fn drives(conn: &Connection) -> rusqlite::Result<HashMap<PathBuf, u64>> {
    let mut stmt = conn.prepare("SELECT path, drive FROM vaults WHERE drive IS NOT NULL")?;
    stmt.query_map([], |row| Ok((PathBuf::from(row.get::<_, String>(0)?), row.get::<_, i64>(1)? as u64)))?
        .collect()
}

/// Every vault the database holds something for: the ones the app opened,
/// and any indexed before it kept that list.
fn known_vaults(conn: &Connection) -> rusqlite::Result<Vec<PathBuf>> {
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
/// place among the vaults opened, which Settings and AI apps list. Without
/// a history to keep it with, the writing it logged goes too.
fn forget_vault(conn: &Connection, vault_path: &Path, has_history: bool) -> Result<(), String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    db::indexer::forget_path(&tx, vault_path, vault_path)?;
    db::attachments::forget_vault_attachments(&tx, vault_path).map_err(|e| e.to_string())?;
    db::ast_cache::prune_stale_ast_cache_for_vault(&tx, &vault_path.to_string_lossy(), &[])?;
    db::settings::forget_vault(&tx, vault_path).map_err(|e| e.to_string())?;
    if !has_history {
        db::data::forget_writing_log(&tx, vault_path).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;

    let thumbnails = db::gallery::thumbnail_folder(vault_path)?;
    match std::fs::remove_dir_all(&thumbnails) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("Couldn't remove {}: {}", thumbnails.display(), error))
        }
        _ => Ok(()),
    }
}

/// Forgets the vaults whose folder is gone, of the ones `conn` holds
/// something for and `also`, and returns them.
fn forget_gone(conn: &Connection, sync_root: &Path, also: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    let drives = drives(conn).map_err(|e| e.to_string())?;
    let mut vaults = known_vaults(conn).map_err(|e| e.to_string())?;
    vaults.extend(also.iter().cloned());
    vaults.sort();
    vaults.dedup();
    let histories: Vec<PathBuf> = state::records(sync_root)
        .into_iter()
        .map(|record| PathBuf::from(record.vault_path))
        .collect();

    let mut gone = Vec::new();
    for vault in vaults.into_iter().filter(|vault| is_gone(vault, drives.get(vault).copied())) {
        match forget_vault(conn, &vault, histories.contains(&vault)) {
            Ok(()) => gone.push(vault),
            Err(error) => eprintln!("[Netherstone] Couldn't forget {}: {}", vault.display(), error),
        }
    }
    Ok(gone)
}

/// Forgets the vaults whose folder is gone, of the ones the app keeps
/// something for and `also`, and returns them.
pub fn forget(also: &[PathBuf]) -> Result<Vec<PathBuf>, String> {
    forget_gone(&db::open_connection()?, &crate::sync::sync_root()?, also)
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

/// Whether a folder a vault was kept for is gone, by what `conn` knows of
/// the drive it was on.
fn gone_by(conn: &Connection) -> Result<impl Fn(&Path) -> bool, String> {
    let drives = drives(conn).map_err(|e| e.to_string())?;
    Ok(move |path: &Path| is_gone(path, drives.get(path).copied()))
}

/// The histories of the vaults whose folder is gone, the biggest first.
pub fn histories(conn: &Connection, sync_root: &Path) -> Result<Vec<GoneHistory>, String> {
    let mut histories: Vec<_> = state::records_of_gone_vaults(sync_root, gone_by(conn)?)
        .into_iter()
        .map(|record| gone_history(sync_root, record))
        .collect();
    histories.sort_by(|a, b| b.size_bytes.cmp(&a.size_bytes).then_with(|| a.name.cmp(&b.name)));
    Ok(histories)
}

/// Moves the history kept as `vault_id` to the trash with `trash`, once it's
/// checked again that its vault is gone. The writing its vault logged goes
/// too, unless another vault is in its folder now. Returns the bytes freed.
pub fn delete_history(
    conn: &Connection,
    sync_root: &Path,
    vault_id: &str,
    trash: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<u64, String> {
    let _history = crate::locks::history(sync_root)?;
    let gone = gone_by(conn)?;
    let record = state::record_of_gone_vault(sync_root, vault_id, &gone)?
        .ok_or("That vault's folder is there again, so its history stays")?;
    let history = gone_history(sync_root, record);
    trash(&state::vault_dir(sync_root, vault_id))?;

    let folder = Path::new(&history.path);
    if gone(folder) {
        let forget = || -> rusqlite::Result<()> {
            let tx = conn.unchecked_transaction()?;
            db::data::forget_writing_log(&tx, folder)?;
            tx.commit()
        };
        forget().map_err(|e| e.to_string())?;
    }
    Ok(history.size_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        db::init_schema(&conn).unwrap();
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        conn
    }

    #[test]
    fn a_vault_is_gone_only_from_a_folder_still_there_on_its_drive() {
        let dir = state::tests::temp_dir("gone-vaults-is-gone");
        let vault = dir.join("Vault");
        std::fs::create_dir_all(&vault).unwrap();
        let drive = drive_of(&vault);
        assert!(drive.is_some());
        assert!(!is_gone(&vault, drive));
        std::fs::remove_dir_all(&vault).unwrap();
        assert!(is_gone(&vault, drive));
        assert!(is_gone(&vault, None));
        // Its drive was mounted on the folder it was in, and isn't now.
        assert!(!is_gone(&vault, drive.map(|drive| drive.wrapping_add(1))));
        // Its drive or share is missing, not the vault.
        assert!(!is_gone(&dir.join("Unplugged/Vault"), None));
    }

    fn add_rows(conn: &Connection, vault: &Path, drive: Option<u64>) {
        let vault_text = vault.to_string_lossy();
        db::settings::record_opened_vault(conn, vault, drive).unwrap();
        for sql in [
            "INSERT INTO files (vault_path, path, name, last_modified, last_indexed, content_hash)
             VALUES (?1, ?1 || '/a.md', 'a.md', 0, 0, '')",
            "INSERT INTO fts_search (rowid, path, name, content)
             SELECT id, path, name, 'text' FROM files WHERE vault_path = ?1",
            "INSERT INTO tags (file_id, tag) SELECT id, 'tag' FROM files WHERE vault_path = ?1",
            "INSERT INTO attachments (vault_path, asset_path, hash, original_name, extension, mime_type, size_bytes, sync_status)
             VALUES (?1, '_attachments/a.png', 'h', 'a.png', 'png', 'image/png', 1, 'syncable')",
            "INSERT INTO ast_cache_index (file_path, content_hash, cache_version) VALUES (?1 || '/a.md', 'h', 1)",
            "INSERT INTO writing_log (day, file_path, start_words, end_words) VALUES ('2026-10-27', ?1 || '/a.md', 0, 5)",
        ] {
            conn.execute(sql, [&vault_text]).unwrap();
        }
    }

    fn rows(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn gone_vaults_are_forgotten_and_the_others_left() {
        let dir = state::tests::temp_dir("gone-vaults-forget");
        let sync_root = dir.join("sync");
        let (kept, gone, kept_history, unmounted) =
            (dir.join("Kept"), dir.join("Gone"), dir.join("History"), dir.join("Mount/Vault"));
        let conn = db();
        for vault in [&kept, &gone, &kept_history] {
            std::fs::create_dir_all(vault).unwrap();
            add_rows(&conn, vault, drive_of(vault));
        }
        state::load_or_create_record(&sync_root, &kept_history).unwrap();
        std::fs::create_dir_all(dir.join("Mount")).unwrap();
        add_rows(&conn, &unmounted, drive_of(&dir).map(|drive| drive.wrapping_add(1)));
        std::fs::remove_dir_all(&gone).unwrap();
        std::fs::remove_dir_all(&kept_history).unwrap();

        // A recent vault the window lists, with nothing in the database.
        let recent = dir.join("Recent");
        let forgotten = forget_gone(&conn, &sync_root, std::slice::from_ref(&recent)).unwrap();

        assert_eq!(forgotten, [gone, kept_history, recent]);
        for table in ["files", "fts_search", "tags", "attachments", "ast_cache_index", "vaults"] {
            assert_eq!(rows(&conn, table), 2, "{table}");
        }
        // The writing goes only with no history to keep it with.
        assert_eq!(rows(&conn, "writing_log"), 3);
        let mut left = known_vaults(&conn).unwrap();
        left.sort();
        assert_eq!(left, [kept, unmounted]);
    }

    #[test]
    fn histories_of_gone_vaults_are_listed_and_trashed_on_request() {
        let dir = state::tests::temp_dir("gone-vaults-history");
        let sync_root = dir.join("sync");
        let (kept, deleted, replaced, unmarked) =
            (dir.join("Kept"), dir.join("Deleted"), dir.join("Replaced"), dir.join("Unmarked"));
        let conn = db();
        let mut ids = Vec::new();
        for vault in [&kept, &deleted, &replaced, &unmarked] {
            std::fs::create_dir_all(vault).unwrap();
            let record = state::load_or_create_record(&sync_root, vault).unwrap();
            std::fs::write(state::vault_dir(&sync_root, &record.vault_id).join("pack"), b"12345").unwrap();
            ids.push(record.vault_id);
        }
        std::fs::remove_dir_all(&deleted).unwrap();
        // A new vault made where an old one was.
        std::fs::remove_dir_all(replaced.join(state::VAULT_META_DIR)).unwrap();
        state::load_or_create_record(&sync_root, &replaced).unwrap();
        // A marker that hasn't come down from a cloud drive yet.
        std::fs::remove_dir_all(unmarked.join(state::VAULT_META_DIR)).unwrap();

        let listed = histories(&conn, &sync_root).unwrap();
        let mut listed_ids: Vec<_> = listed.iter().map(|history| history.vault_id.clone()).collect();
        listed_ids.sort();
        let mut expected = vec![ids[1].clone(), ids[2].clone()];
        expected.sort();
        assert_eq!(listed_ids, expected, "{listed:?}");
        assert!(listed.iter().all(|history| history.size_bytes >= 5));

        let mut trashed = Vec::new();
        let freed = delete_history(&conn, &sync_root, &ids[1], |path| {
            trashed.push(path.to_path_buf());
            Ok(())
        })
        .unwrap();
        assert!(freed >= 5);
        assert_eq!(trashed, [state::vault_dir(&sync_root, &ids[1])]);

        // A vault still in its folder keeps its history.
        for id in [&ids[0], &ids[3]] {
            assert!(delete_history(&conn, &sync_root, id, |_| panic!("trashed a kept vault")).is_err());
        }
        assert!(delete_history(&conn, &sync_root, "../elsewhere", |_| panic!("left the sync folder")).is_err());
    }
}
