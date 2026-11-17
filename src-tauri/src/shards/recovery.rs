//! A copy of a shard's unsaved edits, kept when the editor crashes. It lives
//! in the app's data folder beside the vault's history, one copy per shard,
//! and never in the vault, so it can't replace a shard.

use crate::{sync, vault_access};
use std::path::{Path, PathBuf};

const RECOVERY_DIR: &str = "recovery";

/// Where the copy for `file_path` goes: named by the shard's path in the
/// vault, in the vault's folder of the app's data.
fn copy_path(
    sync_root: &Path,
    vault_id: &str,
    vault: &Path,
    file_path: &Path,
) -> Result<PathBuf, String> {
    let relative = file_path
        .strip_prefix(vault)
        .map_err(|_| format!("{} is outside {}", file_path.display(), vault.display()))?;
    let key = relative
        .components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/");
    let name = format!("{}.json", blake3::hash(key.as_bytes()).to_hex());
    let path = sync::state::vault_dir(sync_root, vault_id)
        .join(RECOVERY_DIR)
        .join(name);
    // App data kept inside the vault: a copy there could land on a shard.
    if vault_access::is_within(vault, &path) {
        return Err(format!("{} is inside the vault", path.display()));
    }
    Ok(path)
}

fn locate(sync_root: &Path, vault_path: &str, file_path: &str) -> Result<PathBuf, String> {
    let (vault, file) = (Path::new(vault_path), Path::new(file_path));
    vault_access::get().check_path_in_known_vault(vault, file)?;
    let record = sync::state::find_record(sync_root, vault)?
        .ok_or_else(|| format!("{} has no app data", vault.display()))?;
    copy_path(sync_root, &record.vault_id, vault, file)
}

fn keep(sync_root: &Path, vault_path: &str, file_path: &str, copy: &str) -> Result<(), String> {
    let path = locate(sync_root, vault_path, file_path)?;
    let folder = path.parent().ok_or("The copy has no folder")?;
    std::fs::create_dir_all(folder)
        .map_err(|e| format!("Failed to create {}: {}", folder.display(), e))?;
    // Write then rename, so a crash never leaves half a copy.
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, copy)
        .map_err(|e| format!("Failed to write {}: {}", temp.display(), e))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn read(sync_root: &Path, vault_path: &str, file_path: &str) -> Result<Option<String>, String> {
    let path = locate(sync_root, vault_path, file_path)?;
    match std::fs::read_to_string(&path) {
        Ok(copy) => Ok(Some(copy)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

fn discard(sync_root: &Path, vault_path: &str, file_path: &str) -> Result<(), String> {
    let path = locate(sync_root, vault_path, file_path)?;
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            Err(format!("Failed to delete {}: {}", path.display(), e))
        }
        _ => Ok(()),
    }
}

fn follow(sync_root: &Path, vault: &Path, old: &str, new: &str) -> Result<(), String> {
    let vault_path = vault.to_string_lossy();
    let (from, to) = (
        locate(sync_root, &vault_path, old)?,
        locate(sync_root, &vault_path, new)?,
    );
    match std::fs::rename(&from, &to) {
        // No copy to take along: one left at the new path belongs to an
        // earlier shard there.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => discard(sync_root, &vault_path, new),
        Err(e) => Err(format!(
            "Failed to move {} to {}: {}",
            from.display(),
            to.display(),
            e
        )),
        Ok(()) => Ok(()),
    }
}

/// Moves the kept edits of a shard renamed or moved from `old` to `new`.
pub(crate) fn follow_shard(vault: &Path, old: &str, new: &str) -> Result<(), String> {
    follow(&sync::sync_root()?, vault, old, new)
}

/// Deletes the kept edits of a deleted shard.
pub(crate) fn forget_shard(vault: &Path, file_path: &str) -> Result<(), String> {
    discard(&sync::sync_root()?, &vault.to_string_lossy(), file_path)
}

/// Keeps `copy` as the shard's unsaved edits, replacing an earlier copy.
#[tauri::command(async)]
pub(crate) fn keep_unsaved_edits(
    vault_path: String,
    file_path: String,
    copy: String,
) -> Result<(), String> {
    keep(&sync::sync_root()?, &vault_path, &file_path, &copy)
}

/// The shard's kept unsaved edits, if any.
#[tauri::command(async)]
pub(crate) fn read_unsaved_edits(
    vault_path: String,
    file_path: String,
) -> Result<Option<String>, String> {
    read(&sync::sync_root()?, &vault_path, &file_path)
}

/// Deletes the shard's kept unsaved edits, if any.
#[tauri::command(async)]
pub(crate) fn discard_unsaved_edits(vault_path: String, file_path: String) -> Result<(), String> {
    discard(&sync::sync_root()?, &vault_path, &file_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    const SHARD_NAMES: [&str; 8] = [
        "Note.md",
        "My note.md",
        "notes/.hidden.md",
        "a.b.c.md",
        "Été/Café ☕ 日本.md",
        "deep/er/still/x.md",
        "recovery.json",
        "no extension",
    ];

    #[test]
    fn a_copy_is_never_the_shard_or_in_the_vault() {
        let root = temp_dir("recovery-paths");
        let sync_root = root.join("sync");
        for vault_name in ["Vault", "My Vault", "v.a.u.l.t", "Ünïcødé 金庫", ".vault"] {
            let vault = root.join(vault_name);
            for shard in SHARD_NAMES {
                let file = vault.join(shard);
                let copy = copy_path(&sync_root, "abc123", &vault, &file).unwrap();
                assert_ne!(copy, file);
                assert!(
                    !vault_access::is_within(&vault, &copy),
                    "{}",
                    copy.display()
                );
            }
        }
    }

    #[test]
    fn refuses_a_copy_when_app_data_is_inside_the_vault() {
        let vault = temp_dir("recovery-inside");
        for shard in SHARD_NAMES {
            assert!(copy_path(&vault.join("sync"), "id", &vault, &vault.join(shard)).is_err());
        }
    }

    #[test]
    fn each_shard_has_its_own_copy() {
        let root = temp_dir("recovery-keys");
        let vault = root.join("Vault");
        let paths: std::collections::HashSet<_> = SHARD_NAMES
            .iter()
            .map(|shard| copy_path(&root.join("sync"), "id", &vault, &vault.join(shard)).unwrap())
            .collect();
        assert_eq!(paths.len(), SHARD_NAMES.len());
    }

    #[test]
    fn keeps_replaces_and_discards_a_copy_without_touching_the_shard() {
        let root = temp_dir("recovery-roundtrip");
        let sync_root = root.join("sync");
        let vault = root.join("Vault");
        std::fs::create_dir_all(&vault).unwrap();
        sync::state::load_or_create_record(&sync_root, &vault).unwrap();
        let shard = vault.join("Note.md");
        std::fs::write(&shard, "On disk").unwrap();
        let (vault_path, file_path) = (vault.to_str().unwrap(), shard.to_str().unwrap());

        assert_eq!(read(&sync_root, vault_path, file_path).unwrap(), None);
        keep(&sync_root, vault_path, file_path, "first").unwrap();
        keep(&sync_root, vault_path, file_path, "second").unwrap();
        assert_eq!(
            read(&sync_root, vault_path, file_path).unwrap().as_deref(),
            Some("second")
        );
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "On disk");

        discard(&sync_root, vault_path, file_path).unwrap();
        discard(&sync_root, vault_path, file_path).unwrap();
        assert_eq!(read(&sync_root, vault_path, file_path).unwrap(), None);
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "On disk");
    }

    #[test]
    fn a_copy_follows_its_shard_to_a_new_path() {
        let root = temp_dir("recovery-follow");
        let sync_root = root.join("sync");
        let vault = root.join("Vault");
        std::fs::create_dir_all(&vault).unwrap();
        sync::state::load_or_create_record(&sync_root, &vault).unwrap();
        let vault_path = vault.to_str().unwrap();
        let old = vault.join("Note.md");
        let new = vault.join("Work").join("Plan.md");
        let (old, new) = (old.to_str().unwrap(), new.to_str().unwrap());

        // A shard without a copy moves without one, even onto a path an
        // earlier shard's copy was left at.
        keep(&sync_root, vault_path, new, "earlier shard").unwrap();
        follow(&sync_root, &vault, old, new).unwrap();
        assert_eq!(read(&sync_root, vault_path, new).unwrap(), None);

        keep(&sync_root, vault_path, old, "kept").unwrap();
        follow(&sync_root, &vault, old, new).unwrap();
        assert_eq!(read(&sync_root, vault_path, old).unwrap(), None);
        assert_eq!(
            read(&sync_root, vault_path, new).unwrap().as_deref(),
            Some("kept")
        );
    }
}
