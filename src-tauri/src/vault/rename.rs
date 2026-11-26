//! Renaming a vault: its folder gets the new name, and what the app keeps
//! for it by path follows, so its settings, writing log and chats carry on.
//! Sync finds a vault by the id inside its folder, so its backup carries on
//! too, under the name it already has.

use super::{VAULT_NAME_EMPTY, VAULT_NAME_INVALID, is_valid_folder_name};
use crate::db;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

/// Why a vault couldn't be renamed, beside the codes a new vault shares. The
/// app turns each into its own message.
pub const VAULT_NAME_TAKEN: &str = "vault-name-taken";
pub const VAULT_IN_USE: &str = "vault-in-use";

/// The path the vault at `vault` would have as `name`, next to where it is.
pub fn renamed_path(vault: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(VAULT_NAME_EMPTY.to_string());
    }
    if !is_valid_folder_name(name) {
        return Err(VAULT_NAME_INVALID.to_string());
    }
    let parent = vault
        .parent()
        .ok_or_else(|| format!("{} has no folder around it", vault.display()))?;
    let renamed = parent.join(name);
    // Changing only the case keeps the folder on Windows and macOS.
    let same_folder = crate::vault_access::is_same(vault, &renamed);
    if !same_folder && renamed.try_exists().unwrap_or(true) {
        return Err(VAULT_NAME_TAKEN.to_string());
    }
    Ok(renamed)
}

/// Renames the folder `vault` to `renamed`.
pub fn rename_folder(vault: &Path, renamed: &Path) -> Result<(), String> {
    std::fs::rename(vault, renamed).map_err(|error| match error.kind() {
        // Windows refuses while another app has a file in it open.
        std::io::ErrorKind::PermissionDenied => VAULT_IN_USE.to_string(),
        _ => format!("Couldn't rename {}: {}", vault.display(), error),
    })
}

/// Points what the database keeps for the vault at `old` to `new`: its
/// place among the vaults opened, with AI access, its writing log and its
/// drawing pictures. Its search index and thumbnails are made again at the
/// new path.
pub fn follow_in_database(conn: &Connection, old: &Path, new: &Path) -> Result<(), String> {
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    db::indexer::forget_path(&tx, old, old)?;
    db::attachments::rename_vault_drawing_pictures(&tx, old, new).map_err(|e| e.to_string())?;
    db::attachments::forget_vault_attachments(&tx, old).map_err(|e| e.to_string())?;
    db::ast_cache::prune_stale_ast_cache_for_vault(&tx, &old.to_string_lossy(), &[])?;
    db::settings::rename_vault(&tx, old, new).map_err(|e| e.to_string())?;
    db::data::rename_writing_vault(&tx, old, new).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;

    let thumbnails = db::gallery::thumbnail_folder(old)?;
    match std::fs::remove_dir_all(&thumbnails) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(format!(
            "Couldn't remove {}: {}",
            thumbnails.display(),
            error
        )),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    #[test]
    fn a_new_name_must_be_free_and_valid() {
        let dir = temp_dir("rename-vault-names");
        let vault = dir.join("Notes");
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(dir.join("Work")).unwrap();

        assert_eq!(
            renamed_path(&vault, " Journal ").unwrap(),
            dir.join("Journal")
        );
        assert_eq!(renamed_path(&vault, "  ").unwrap_err(), VAULT_NAME_EMPTY);
        assert_eq!(renamed_path(&vault, "a/b").unwrap_err(), VAULT_NAME_INVALID);
        assert_eq!(renamed_path(&vault, "Work").unwrap_err(), VAULT_NAME_TAKEN);
        assert_eq!(renamed_path(&vault, "Notes").unwrap(), vault);
    }

    #[test]
    fn what_the_vault_keeps_follows_it() {
        let dir = temp_dir("rename-vault-follow");
        let conn = Connection::open(dir.join("db.sqlite")).unwrap();
        db::init_schema(&conn).unwrap();
        let old = dir.join("Notes");
        let new = dir.join("Journal");
        std::fs::create_dir_all(&old).unwrap();
        std::fs::write(old.join("a.md"), "Hello there").unwrap();
        db::settings::record_opened_vault(&conn, &old, None).unwrap();
        db::settings::set_vault_ai_allowed(&conn, &old, true).unwrap();
        db::indexer::index_file(&conn, &old, &old.join("a.md")).unwrap();
        let shard = old.join("a.md").to_string_lossy().into_owned();
        db::data::start_writing_log(&conn, &old.to_string_lossy(), "2026-11-01").unwrap();
        db::data::record_writing(&conn, "2026-11-02", &shard, "Hello there", || None).unwrap();
        let picture = "INSERT INTO drawing_pictures (vault_path, asset_path) VALUES (?1, ?2)";
        conn.execute(
            picture,
            [old.to_string_lossy(), "_attachments/d.png".into()],
        )
        .unwrap();

        rename_folder(&old, &new).unwrap();
        follow_in_database(&conn, &old, &new).unwrap();

        assert!(new.join("a.md").is_file());
        let kept = db::settings::known_vault(&conn, &new).unwrap().unwrap();
        assert!(kept.ai_allowed);
        assert!(db::settings::known_vault(&conn, &old).unwrap().is_none());
        let indexed: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM files WHERE vault_path = ?1",
                [old.to_string_lossy()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(indexed, 0);
        let logged: Vec<String> = conn
            .prepare("SELECT file_path FROM writing_log")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(logged, [new.join("a.md").to_string_lossy().into_owned()]);
        let started: String = conn
            .query_row("SELECT vault_path FROM writing_log_start", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(started, new.to_string_lossy());
        let pictures: Vec<String> = conn
            .prepare("SELECT vault_path FROM drawing_pictures")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(pictures, [new.to_string_lossy().into_owned()]);
    }
}
