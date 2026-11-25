//! Deleting files: the OS trash on desktop. Phones have none, so there a
//! deleted file moves to a trash folder in the app's data, where it can be
//! brought back.
//!
//! Each delete gets its own folder in the trash, `trash/<batch>/`, holding
//! what was deleted under its own name. Beside it, `trash/<batch>.json`
//! records where each one came from, so it can go back there.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Component, Path, PathBuf};

#[cfg(desktop)]
pub use trash::{delete, delete_all};

#[cfg(mobile)]
pub fn delete(path: impl AsRef<Path>) -> Result<(), String> {
    delete_vault_item(path.as_ref()).map(|_| ())
}

#[cfg(mobile)]
pub fn delete_all<T: AsRef<Path>>(paths: impl IntoIterator<Item = T>) -> Result<(), String> {
    let name = unique_name();
    let trash = trash_dir()?;
    paths
        .into_iter()
        .try_for_each(|path| move_to_trash(&trash, path.as_ref(), &name).map(|_| ()))
}

/// Deletes a file or folder of a vault. On a phone it returns the trash
/// item it became, so it can be brought back at once.
pub fn delete_vault_item(path: &Path) -> Result<Option<String>, String> {
    #[cfg(desktop)]
    {
        trash::delete(path).map_err(|e| e.to_string())?;
        Ok(None)
    }
    #[cfg(mobile)]
    {
        move_to_trash(&trash_dir()?, path, &unique_name()).map(Some)
    }
}

fn trash_dir() -> Result<PathBuf, String> {
    Ok(crate::db::app_data_dir()?.join("trash"))
}

/// A folder name per delete, so two deletes of files with the same name keep
/// both. Milliseconds since 1970, then a counter for deletes in the same one.
#[cfg(mobile)]
fn unique_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNT: AtomicU64 = AtomicU64::new(0);
    format!("{}-{}", now_millis(), COUNT.fetch_add(1, Ordering::Relaxed))
}

#[cfg(any(mobile, test))]
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as u64)
}

/// Where the files of one delete came from, kept beside its folder.
#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Record {
    deleted_at: u64,
    /// Each item's name in the batch folder, and the path it had.
    from: BTreeMap<String, PathBuf>,
}

fn record_path(trash: &Path, batch: &str) -> PathBuf {
    trash.join(format!("{batch}.json"))
}

fn read_record(trash: &Path, batch: &str) -> Option<Record> {
    let text = std::fs::read_to_string(record_path(trash, batch)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_record(trash: &Path, batch: &str, record: &Record) -> Result<(), String> {
    let path = record_path(trash, batch);
    if record.from.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                Err(format!("Failed to remove {}: {}", path.display(), e))
            }
            _ => Ok(()),
        };
    }
    let text = serde_json::to_string(record).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

/// Moves `path` into `trash/<batch>/`, keeping its name, and records where
/// it came from. Returns its id in the trash. A vault on another storage
/// volume than the app's data can't be renamed across, so it is copied and
/// then removed.
#[cfg(any(mobile, test))]
fn move_to_trash(trash: &Path, path: &Path, batch: &str) -> Result<String, String> {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| format!("{} has no name to keep in the trash", path.display()))?;
    let folder = trash.join(batch);
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Failed to create {}: {}", folder.display(), e))?;
    let to = folder.join(name);
    if to.exists() {
        return Err(format!("{} is already in the trash", to.display()));
    }
    move_path(path, &to)?;

    let mut record = read_record(trash, batch).unwrap_or_else(|| Record {
        deleted_at: now_millis(),
        from: BTreeMap::new(),
    });
    record.from.insert(name.to_string(), path.to_path_buf());
    write_record(trash, batch, &record)?;
    Ok(format!("{batch}/{name}"))
}

/// Renames `from` to `to`, or copies it and removes the original when they
/// are on different storage volumes.
fn move_path(from: &Path, to: &Path) -> Result<(), String> {
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_all(from, to).map_err(|e| format!("Failed to copy {}: {}", from.display(), e))?;
    remove_path(from)
}

fn remove_path(path: &Path) -> Result<(), String> {
    let removed = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    removed.map_err(|e| format!("Failed to remove {}: {}", path.display(), e))
}

fn copy_all(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.is_dir() {
        return std::fs::copy(from, to).map(|_| ());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        copy_all(&entry.path(), &to.join(entry.file_name()))?;
    }
    Ok(())
}

fn size_of(path: &Path) -> u64 {
    if !path.is_dir() {
        return std::fs::metadata(path).map_or(0, |meta| meta.len());
    }
    std::fs::read_dir(path).map_or(0, |entries| {
        entries
            .filter_map(Result::ok)
            .map(|entry| size_of(&entry.path()))
            .sum()
    })
}

/// One deleted file or folder, as the Trash lists it.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedItem {
    /// `<batch>/<name>`, what the other trash commands take.
    pub id: String,
    pub name: String,
    /// The path it had, where Restore puts it back.
    pub from: PathBuf,
    pub is_folder: bool,
    /// Milliseconds since 1970.
    pub deleted_at: u64,
    pub bytes: u64,
    /// For what isn't a file of the vault, such as the history of a vault
    /// that's gone: the name of the vault it was kept for.
    pub history_of: Option<String>,
}

/// The vault a trashed sync history was kept for, by its record inside it.
fn history_name(trash: &Path, batch: &str, name: &str) -> Option<String> {
    crate::sync::state::records(&trash.join(batch))
        .into_iter()
        .find(|record| record.vault_id == name)
        .map(|record| {
            Path::new(&record.vault_path)
                .file_name()
                .map_or(record.vault_path.clone(), |name| {
                    name.to_string_lossy().into_owned()
                })
        })
}

/// Whether `from` is in `vault` or among the vault histories in `histories`.
fn belongs(vault: &Path, histories: &Path, from: &Path) -> bool {
    crate::vault_access::is_within(vault, from) || crate::vault_access::is_within(histories, from)
}

/// Whether `list` would show the item `id`.
fn is_listed(trash: &Path, id: &str, vault: &Path, histories: &Path) -> bool {
    let Ok((batch, name)) = parse_id(id) else {
        return false;
    };
    read_record(trash, batch)
        .and_then(|record| record.from.get(name).cloned())
        .is_some_and(|from| {
            trash.join(batch).join(name).exists() && belongs(vault, histories, &from)
        })
}

/// What's in the trash from `vault`, and the vault histories kept in
/// `histories` (they belong to no vault), most recently deleted first.
fn list(trash: &Path, vault: &Path, histories: &Path) -> Vec<TrashedItem> {
    let Ok(entries) = std::fs::read_dir(trash) else {
        return Vec::new();
    };
    let mut items: Vec<TrashedItem> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter_map(|batch| read_record(trash, &batch).map(|record| (batch, record)))
        .flat_map(|(batch, record)| {
            let deleted_at = record.deleted_at;
            record.from.into_iter().map(move |(name, from)| {
                let kept = trash.join(&batch).join(&name);
                (batch.clone(), name, from, kept, deleted_at)
            })
        })
        .filter(|(_, _, from, kept, _)| kept.exists() && belongs(vault, histories, from))
        .map(|(batch, name, from, kept, deleted_at)| TrashedItem {
            id: format!("{batch}/{name}"),
            is_folder: kept.is_dir(),
            bytes: size_of(&kept),
            history_of: crate::vault_access::is_within(histories, &from)
                .then(|| history_name(trash, &batch, &name))
                .flatten(),
            name,
            from,
            deleted_at,
        })
        .collect();
    items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(a.name.cmp(&b.name)));
    items
}

/// The batch and name in `id`, refusing anything that isn't exactly two
/// plain names, so an id can't reach outside the trash.
fn parse_id(id: &str) -> Result<(&str, &str), String> {
    let invalid = || format!("Not a trash item: {id}");
    let (batch, name) = id.split_once('/').ok_or_else(invalid)?;
    let plain = |part: &str| {
        let mut components = Path::new(part).components();
        matches!(components.next(), Some(Component::Normal(_))) && components.next().is_none()
    };
    if plain(batch) && plain(name) && !name.contains('\\') && !batch.contains('\\') {
        Ok((batch, name))
    } else {
        Err(invalid())
    }
}

/// Puts the item `id` back where it was, under a free name if that one has
/// been taken since, and returns where it went. `allowed` says whether a
/// path may be restored to.
fn restore(
    trash: &Path,
    id: &str,
    allowed: impl Fn(&Path) -> Result<(), String>,
) -> Result<PathBuf, String> {
    let (batch, name) = parse_id(id)?;
    let mut record = read_record(trash, batch).ok_or_else(|| format!("{id} isn't in the trash"))?;
    let from = record
        .from
        .get(name)
        .cloned()
        .ok_or_else(|| format!("{id} isn't in the trash"))?;
    allowed(&from)?;
    let parent = from
        .parent()
        .ok_or_else(|| format!("{} has no folder to go back to", from.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    let to = crate::vault::free_path(&from);
    move_path(&trash.join(batch).join(name), &to)?;
    record.from.remove(name);
    forget_batch_if_empty(trash, batch, &record)?;
    Ok(to)
}

/// Deletes the item `id` for good.
fn delete_forever(trash: &Path, id: &str) -> Result<(), String> {
    let (batch, name) = parse_id(id)?;
    let mut record = read_record(trash, batch).ok_or_else(|| format!("{id} isn't in the trash"))?;
    let kept = trash.join(batch).join(name);
    if kept.exists() {
        remove_path(&kept)?;
    }
    record.from.remove(name);
    forget_batch_if_empty(trash, batch, &record)
}

fn forget_batch_if_empty(trash: &Path, batch: &str, record: &Record) -> Result<(), String> {
    write_record(trash, batch, record)?;
    if record.from.is_empty() {
        let folder = trash.join(batch);
        if folder.exists() {
            remove_path(&folder)?;
        }
    }
    Ok(())
}

/// What's in the trash from the open vault, most recently deleted first.
#[tauri::command(async)]
pub(crate) fn list_app_trash() -> Result<Vec<TrashedItem>, String> {
    let vault = crate::vault_access::get().open_vault()?;
    Ok(list(&trash_dir()?, &vault, &crate::sync::sync_root()?))
}

/// Puts trash items back in the open vault, or a vault's history back with
/// the others. Returns where each one went.
#[tauri::command(async)]
pub(crate) fn restore_app_trash(ids: Vec<String>) -> Result<Vec<String>, String> {
    let vault = crate::vault_access::get().open_vault()?;
    let histories = crate::sync::sync_root()?;
    let trash = trash_dir()?;
    let _writes = crate::locks::vault_writes()?;
    ids.iter()
        .map(|id| {
            restore(&trash, id, |path| {
                if belongs(&vault, &histories, path) {
                    Ok(())
                } else {
                    Err(format!("{} isn't in the open vault", path.display()))
                }
            })
            .map(|path| path.to_string_lossy().into_owned())
        })
        .collect()
}

/// Deletes trash items for good. Only items from the open vault are taken.
#[tauri::command(async)]
pub(crate) fn delete_app_trash(ids: Vec<String>) -> Result<(), String> {
    let vault = crate::vault_access::get().open_vault()?;
    let histories = crate::sync::sync_root()?;
    let trash = trash_dir()?;
    ids.iter().try_for_each(|id| {
        if !is_listed(&trash, id, &vault, &histories) {
            return Err(format!("{id} isn't in this vault's trash"));
        }
        delete_forever(&trash, id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        crate::sync::state::tests::temp_dir(name)
    }

    fn write(path: &Path, text: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn anywhere(_: &Path) -> Result<(), String> {
        Ok(())
    }

    #[test]
    fn a_deleted_folder_keeps_its_files_in_the_trash() {
        let root = temp("app-trash-folder");
        let folder = root.join("vault").join("Ideas");
        write(&folder.join("Inner").join("one.md"), "# One");
        let trash = root.join("trash");

        let id = move_to_trash(&trash, &folder, "1").unwrap();

        assert_eq!(id, "1/Ideas");
        assert!(!folder.exists());
        let kept = trash.join("1").join("Ideas").join("Inner").join("one.md");
        assert_eq!(std::fs::read_to_string(kept).unwrap(), "# One");
    }

    #[test]
    fn two_files_with_one_name_both_stay_in_the_trash() {
        let root = temp("app-trash-same-name");
        let trash = root.join("trash");
        for (batch, text) in [("1", "first"), ("2", "second")] {
            let file = root.join(batch).join("note.md");
            write(&file, text);
            move_to_trash(&trash, &file, batch).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(trash.join("1/note.md")).unwrap(),
            "first"
        );
        assert_eq!(
            std::fs::read_to_string(trash.join("2/note.md")).unwrap(),
            "second"
        );
    }

    #[test]
    fn copying_keeps_every_file_of_a_folder() {
        let root = temp("app-trash-copy");
        let from = root.join("from");
        write(&from.join("a/b/c.md"), "deep");
        write(&from.join("top.md"), "top");

        copy_all(&from, &root.join("to")).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("to/a/b/c.md")).unwrap(),
            "deep"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("to/top.md")).unwrap(),
            "top"
        );
    }

    #[test]
    fn the_trash_lists_only_the_vaults_own_items_newest_first() {
        let root = temp("app-trash-list");
        let vault = root.join("vault");
        let other = root.join("other");
        let trash = root.join("trash");
        write(&vault.join("Journal/old.md"), "old");
        write(&vault.join("new.md"), "new!");
        write(&other.join("elsewhere.md"), "x");
        move_to_trash(&trash, &vault.join("Journal/old.md"), "1").unwrap();
        move_to_trash(&trash, &other.join("elsewhere.md"), "2").unwrap();
        move_to_trash(&trash, &vault.join("new.md"), "3").unwrap();
        // Deleted in this order, a millisecond apart or in the same one.
        for (batch, at) in [("1", 100), ("3", 300)] {
            let mut record = read_record(&trash, batch).unwrap();
            record.deleted_at = at;
            write_record(&trash, batch, &record).unwrap();
        }

        let items = list(&trash, &vault, &root.join("sync"));

        assert_eq!(
            items,
            [
                TrashedItem {
                    id: "3/new.md".into(),
                    name: "new.md".into(),
                    from: vault.join("new.md"),
                    is_folder: false,
                    deleted_at: 300,
                    bytes: 4,
                    history_of: None,
                },
                TrashedItem {
                    id: "1/old.md".into(),
                    name: "old.md".into(),
                    from: vault.join("Journal/old.md"),
                    is_folder: false,
                    deleted_at: 100,
                    bytes: 3,
                    history_of: None,
                },
            ]
        );
        let sync = root.join("sync");
        assert!(is_listed(&trash, "3/new.md", &vault, &sync));
        assert!(!is_listed(&trash, "2/elsewhere.md", &vault, &sync));
        assert!(!is_listed(&trash, "3/gone.md", &vault, &sync));
    }

    #[test]
    fn restore_puts_an_item_back_and_forgets_its_batch() {
        let root = temp("app-trash-restore");
        let trash = root.join("trash");
        let file = root.join("vault/Journal/day.md");
        write(&file, "today");
        let id = move_to_trash(&trash, &file, "1").unwrap();
        // Its folder went too, after the shard did.
        std::fs::remove_dir(file.parent().unwrap()).unwrap();

        let back = restore(&trash, &id, anywhere).unwrap();

        assert_eq!(back, file);
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "today");
        assert!(!trash.join("1").exists());
        assert!(!record_path(&trash, "1").exists());
    }

    #[test]
    fn restore_keeps_a_new_file_with_the_same_name() {
        let root = temp("app-trash-restore-taken");
        let trash = root.join("trash");
        let file = root.join("vault/note.md");
        write(&file, "deleted");
        let id = move_to_trash(&trash, &file, "1").unwrap();
        write(&file, "made since");

        let back = restore(&trash, &id, anywhere).unwrap();

        assert_eq!(back, root.join("vault/note 2.md"));
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "made since");
        assert_eq!(std::fs::read_to_string(&back).unwrap(), "deleted");
    }

    #[test]
    fn restore_refuses_a_place_it_isnt_allowed() {
        let root = temp("app-trash-restore-refused");
        let trash = root.join("trash");
        let file = root.join("vault/note.md");
        write(&file, "kept");
        let id = move_to_trash(&trash, &file, "1").unwrap();

        let refused = restore(&trash, &id, |_| Err("not here".into()));

        assert_eq!(refused, Err("not here".into()));
        assert!(trash.join("1/note.md").exists());
    }

    #[test]
    fn delete_forever_removes_one_item_and_keeps_the_rest_of_its_batch() {
        let root = temp("app-trash-delete");
        let trash = root.join("trash");
        let vault = root.join("vault");
        write(&vault.join("a.md"), "a");
        write(&vault.join("b.md"), "b");
        move_to_trash(&trash, &vault.join("a.md"), "1").unwrap();
        move_to_trash(&trash, &vault.join("b.md"), "1").unwrap();

        delete_forever(&trash, "1/a.md").unwrap();

        let left: Vec<_> = list(&trash, &vault, &root.join("sync"))
            .into_iter()
            .map(|item| item.id)
            .collect();
        assert_eq!(left, ["1/b.md"]);
        delete_forever(&trash, "1/b.md").unwrap();
        assert!(!trash.join("1").exists());
        assert!(!record_path(&trash, "1").exists());
    }

    #[test]
    fn a_gone_vaults_history_is_listed_by_its_vaults_name() {
        let root = temp("app-trash-history");
        let vault = root.join("vault");
        let sync = root.join("sync");
        let trash = root.join("trash");
        std::fs::create_dir_all(&vault).unwrap();
        crate::sync::state::save_record(
            &sync,
            &crate::sync::state::VaultSyncRecord {
                vault_id: "abc".into(),
                vault_path: root.join("Old notes").to_string_lossy().into_owned(),
                sync_enabled: false,
                remote_url: None,
                repo_name: None,
                branch: "main".into(),
                last_commit: None,
                last_commit_at: None,
                last_sync_at: None,
                last_packed_at: None,
                conflicts: Vec::new(),
            },
        )
        .unwrap();
        move_to_trash(&trash, &sync.join("abc"), "1").unwrap();

        let items = list(&trash, &vault, &sync);

        assert_eq!(items.len(), 1);
        assert_eq!(items[0].history_of.as_deref(), Some("Old notes"));
        let back = restore(&trash, &items[0].id, anywhere).unwrap();
        assert_eq!(back, sync.join("abc"));
    }

    #[test]
    fn ids_that_leave_the_trash_are_refused() {
        for id in [
            "..",
            "../x",
            "1/../x",
            "1/..",
            "/etc/passwd",
            "1",
            "1/a/b",
            "1\\..\\x",
        ] {
            assert!(parse_id(id).is_err(), "{id} was taken");
        }
        assert_eq!(parse_id("1700-0/note.md"), Ok(("1700-0", "note.md")));
    }
}
