//! Packing a vault's repository: every version is written to the repository
//! as its own compressed file, which adds up to hundreds of megabytes a year.
//! Once a day the app packs everything still in the history into one file,
//! storing similar versions as differences, and removes the loose files and
//! older packs, along with anything no version uses any more.

use super::state;
use git2::{ObjectType, Oid, Repository};
use std::path::Path;
use std::time::Duration;

/// How long after a pack the next one is due.
pub const PACK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

fn git_error(context: &str, e: git2::Error) -> String {
    format!("{}: {}", context, e.message())
}

/// How much a pack freed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Packed {
    pub bytes_before: u64,
    pub bytes_after: u64,
}

/// Packs the vault's repository when the last pack was a day ago or more,
/// or it was never packed. `None` when it wasn't due, or has no history.
pub fn pack_if_due(sync_root: &Path, vault_path: &Path) -> Result<Option<Packed>, String> {
    let Some(record) = state::find_record(sync_root, vault_path)? else {
        return Ok(None);
    };
    let now = super::now_unix_seconds();
    let due = record
        .last_packed_at
        .is_none_or(|at| now - at >= PACK_INTERVAL.as_secs() as i64);
    if !due {
        return Ok(None);
    }
    pack_vault(sync_root, vault_path).map(Some)
}

/// Packs the vault's repository now. Waits for a sync and for any history
/// work to finish, and holds both off until it's done.
pub fn pack_vault(sync_root: &Path, vault_path: &Path) -> Result<Packed, String> {
    let _sync = crate::locks::sync(sync_root)?;
    let _history = crate::locks::history(sync_root)?;
    let mut record = state::load_or_create_record(sync_root, vault_path)?;
    let git_dir = state::git_dir(sync_root, &record.vault_id);
    let packed = if git_dir.join("HEAD").exists() {
        pack_repository(&git_dir, &record)?
    } else {
        Packed {
            bytes_before: 0,
            bytes_after: 0,
        }
    };
    record.last_packed_at = Some(super::now_unix_seconds());
    state::save_record(sync_root, &record)?;
    Ok(packed)
}

/// Every object the repository still needs: the versions on every branch,
/// what the index stages, and the other side of every unsettled conflict.
fn insert_needed(
    repository: &Repository,
    builder: &mut git2::PackBuilder,
    record: &state::VaultSyncRecord,
) -> Result<(), String> {
    let read = |e| git_error("Failed to read history", e);
    let mut walk = repository.revwalk().map_err(read)?;
    for reference in repository.references().map_err(read)? {
        let reference = reference.map_err(read)?;
        if let Ok(commit) = reference.peel_to_commit() {
            walk.push(commit.id()).map_err(read)?;
        }
    }
    builder.insert_walk(&mut walk).map_err(read)?;

    let index = repository.index().map_err(read)?;
    for entry in index.iter() {
        if repository
            .find_object(entry.id, Some(ObjectType::Blob))
            .is_ok()
        {
            builder.insert_object(entry.id, None).map_err(read)?;
        }
    }
    for conflict in &record.conflicts {
        if let Ok(id) = Oid::from_str(&conflict.theirs)
            && repository.find_blob(id).is_ok()
        {
            builder.insert_object(id, None).map_err(read)?;
        }
    }
    Ok(())
}

fn objects_size(objects: &Path) -> u64 {
    fn walk(dir: &Path) -> u64 {
        std::fs::read_dir(dir)
            .into_iter()
            .flatten()
            .flatten()
            .map(|entry| match entry.file_type() {
                Ok(kind) if kind.is_dir() => walk(&entry.path()),
                _ => entry.metadata().map(|m| m.len()).unwrap_or(0),
            })
            .sum()
    }
    walk(objects)
}

/// A loose object's folder: two hex digits.
fn is_loose_folder(name: &str) -> bool {
    name.len() == 2 && name.chars().all(|c| c.is_ascii_hexdigit())
}

fn remove(path: &Path) {
    // A file still open elsewhere (Windows) stays until the next pack.
    if let Err(e) = std::fs::remove_file(path) {
        eprintln!("[Netherstone] Couldn't remove {}: {}", path.display(), e);
    }
}

pub(super) fn pack_repository(
    git_dir: &Path,
    record: &state::VaultSyncRecord,
) -> Result<Packed, String> {
    let objects = git_dir.join("objects");
    let pack_dir = objects.join("pack");
    let bytes_before = objects_size(&objects);

    let new_pack = {
        let repository = Repository::open(git_dir)
            .map_err(|e| git_error("Failed to open sync repository", e))?;
        let mut builder = repository
            .packbuilder()
            .map_err(|e| git_error("Failed to pack history", e))?;
        insert_needed(&repository, &mut builder, record)?;
        if builder.object_count() == 0 {
            return Ok(Packed {
                bytes_before,
                bytes_after: bytes_before,
            });
        }
        std::fs::create_dir_all(&pack_dir)
            .map_err(|e| format!("Failed to create {}: {}", pack_dir.display(), e))?;
        builder
            .write(&pack_dir, 0o644)
            .map_err(|e| git_error("Failed to pack history", e))?;
        let name = builder
            .name()
            .ok()
            .flatten()
            .ok_or_else(|| "Failed to pack history".to_string())?;
        format!("pack-{}", name)
    };

    // The new pack holds everything needed; the rest goes.
    for entry in std::fs::read_dir(&pack_dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let is_old_pack = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|stem| stem.starts_with("pack-") && stem != new_pack);
        if is_old_pack {
            remove(&path);
        }
    }
    for entry in std::fs::read_dir(&objects).into_iter().flatten().flatten() {
        if entry.file_name().to_str().is_some_and(is_loose_folder) {
            for loose in std::fs::read_dir(entry.path())
                .into_iter()
                .flatten()
                .flatten()
            {
                remove(&loose.path());
            }
            let _ = std::fs::remove_dir(entry.path());
        }
    }

    Ok(Packed {
        bytes_before,
        bytes_after: objects_size(&objects),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use std::fs;

    fn loose_count(git_dir: &Path) -> usize {
        fs::read_dir(git_dir.join("objects"))
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_str().is_some_and(is_loose_folder))
            .map(|e| fs::read_dir(e.path()).unwrap().count())
            .sum()
    }

    #[test]
    fn packs_the_history_and_keeps_every_version_readable() {
        let dir = temp_dir("pack");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        // A long shard, edited a little each time.
        let mut text: String = (0..400)
            .map(|i| format!("Paragraph {} of what was there before.\n", i))
            .collect();
        for i in 0..40 {
            text.push_str(&format!("Line {} of a shard that keeps growing.\n", i));
            fs::write(vault.join("Note.md"), &text).unwrap();
            crate::sync::snapshot_vault(&sync_root, &vault).unwrap();
        }
        let record = state::find_record(&sync_root, &vault).unwrap().unwrap();
        let git_dir = state::git_dir(&sync_root, &record.vault_id);
        assert!(loose_count(&git_dir) > 100);

        let packed = pack_vault(&sync_root, &vault).unwrap();
        assert_eq!(loose_count(&git_dir), 0);
        assert!(packed.bytes_after * 3 < packed.bytes_before, "{:?}", packed);

        let history =
            crate::sync::history::list_versions(&sync_root, &vault, &vault.join("Note.md"))
                .unwrap();
        assert_eq!(history.versions.len(), 39);
        let oldest = history.versions.last().unwrap();
        assert_eq!(
            crate::sync::history::read_version(&sync_root, &vault, &oldest.blob).unwrap(),
            &text[..text.find("Line 1 ").unwrap()]
        );

        // Saving and packing again works on a packed repository.
        fs::write(vault.join("Note.md"), "Rewritten").unwrap();
        assert!(
            crate::sync::snapshot_vault(&sync_root, &vault)
                .unwrap()
                .commit
                .is_some()
        );
        pack_vault(&sync_root, &vault).unwrap();
        let packs: Vec<_> = fs::read_dir(git_dir.join("objects/pack"))
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "pack"))
            .collect();
        assert_eq!(packs.len(), 1);
    }

    #[test]
    fn drops_what_no_version_uses() {
        let dir = temp_dir("pack-unused");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "Kept").unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();
        let record = state::find_record(&sync_root, &vault).unwrap().unwrap();
        let git_dir = state::git_dir(&sync_root, &record.vault_id);
        let repository = Repository::open(&git_dir).unwrap();
        let unused = repository.blob(b"Nothing points at this").unwrap();

        pack_vault(&sync_root, &vault).unwrap();
        let repository = Repository::open(&git_dir).unwrap();
        assert!(repository.find_blob(unused).is_err());
    }

    #[test]
    fn packs_once_a_day() {
        let dir = temp_dir("pack-due");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "Text").unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();

        assert!(pack_if_due(&sync_root, &vault).unwrap().is_some());
        assert!(pack_if_due(&sync_root, &vault).unwrap().is_none());

        let mut record = state::find_record(&sync_root, &vault).unwrap().unwrap();
        record.last_packed_at = Some(super::super::now_unix_seconds() - 25 * 60 * 60);
        state::save_record(&sync_root, &record).unwrap();
        assert!(pack_if_due(&sync_root, &vault).unwrap().is_some());
    }
}
