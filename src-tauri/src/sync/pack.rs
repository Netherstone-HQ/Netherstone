//! Packing a vault's repository: every version is written to the repository
//! as its own compressed file, which adds up to hundreds of megabytes a year.
//! Once a day the app packs the shards, drawings and versions still in the
//! history into one file, storing similar versions as differences, and
//! removes the loose files and older packs, along with anything no version
//! uses any more. Attachments stay loose files, one each: they are
//! compressed already and never differ by a little, so packing them again
//! every day would only cost time and memory.

use super::state;
use git2::{ObjectType, Oid, Repository};
use std::collections::HashSet;
use std::io::Write;
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
    if state::find_record(sync_root, vault_path)?.is_none() {
        return Ok(None);
    }
    let _sync = crate::locks::sync(sync_root)?;
    let _history = crate::locks::history(sync_root)?;
    // Checked under the locks, so versions saved while a pack runs don't
    // start another once it's done.
    let record = state::load_or_create_record(sync_root, vault_path)?;
    let now = super::now_unix_seconds();
    let due = record
        .last_packed_at
        .is_none_or(|at| now - at >= PACK_INTERVAL.as_secs() as i64);
    if !due {
        return Ok(None);
    }
    pack_locked(sync_root, record).map(Some)
}

/// Packs the vault's repository now. Waits for a sync and for any history
/// work to finish, and holds both off until it's done.
#[cfg(test)]
pub fn pack_vault(sync_root: &Path, vault_path: &Path) -> Result<Packed, String> {
    let _sync = crate::locks::sync(sync_root)?;
    let _history = crate::locks::history(sync_root)?;
    pack_locked(
        sync_root,
        state::load_or_create_record(sync_root, vault_path)?,
    )
}

fn pack_locked(sync_root: &Path, mut record: state::VaultSyncRecord) -> Result<Packed, String> {
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

fn is_attachment(path: &str) -> bool {
    path.split('/').next() == Some(crate::db::attachments::ATTACHMENTS_DIR_NAME)
}

/// Every object the repository still needs: the versions on every branch,
/// what the index stages, and the other side of every unsettled conflict.
#[derive(Default)]
struct Needed {
    /// Versions, folders, shards and drawings: what goes into the pack.
    packed: HashSet<Oid>,
    /// The same, in the order found, each blob with its path: Git finds the
    /// differences between versions of a file by its name.
    order: Vec<(Oid, Option<String>)>,
    /// Attachments, which stay loose.
    loose: HashSet<Oid>,
}

impl Needed {
    fn add_blob(&mut self, id: Oid, path: &str) {
        if is_attachment(path) {
            self.loose.insert(id);
        } else {
            self.pack(id, Some(path));
        }
    }

    /// Adds `id` to the pack. False when it was already.
    fn pack(&mut self, id: Oid, path: Option<&str>) -> bool {
        let new = self.packed.insert(id);
        if new {
            self.order.push((id, path.map(String::from)));
        }
        new
    }

    /// Adds `tree` and what's in it, `prefix` being its path in the vault.
    fn add_tree(&mut self, repository: &Repository, id: Oid, prefix: &str) -> Result<(), String> {
        let read = |e| git_error("Failed to read history", e);
        // A folder seen before holds the same files at the same path.
        if !self.pack(id, Some(prefix.trim_end_matches('/'))) {
            return Ok(());
        }
        let tree = repository.find_tree(id).map_err(read)?;
        for entry in tree.iter() {
            let path = format!("{}{}", prefix, String::from_utf8_lossy(entry.name_bytes()));
            match entry.kind() {
                Some(ObjectType::Tree) => {
                    self.add_tree(repository, entry.id(), &format!("{}/", path))?
                }
                Some(ObjectType::Blob) => self.add_blob(entry.id(), &path),
                _ => {}
            }
        }
        Ok(())
    }

    fn find(repository: &Repository, record: &state::VaultSyncRecord) -> Result<Self, String> {
        let read = |e| git_error("Failed to read history", e);
        let mut needed = Needed::default();
        let mut walk = repository.revwalk().map_err(read)?;
        for reference in repository.references().map_err(read)? {
            let reference = reference.map_err(read)?;
            if let Ok(commit) = reference.peel_to_commit() {
                walk.push(commit.id()).map_err(read)?;
            }
        }
        for id in walk {
            let commit = repository.find_commit(id.map_err(read)?).map_err(read)?;
            needed.pack(commit.id(), None);
            needed.add_tree(repository, commit.tree_id(), "")?;
        }

        let index = repository.index().map_err(read)?;
        for entry in index.iter() {
            if repository
                .find_object(entry.id, Some(ObjectType::Blob))
                .is_ok()
            {
                needed.add_blob(entry.id, &String::from_utf8_lossy(&entry.path));
            }
        }
        for conflict in &record.conflicts {
            if let Ok(id) = Oid::from_str(&conflict.theirs)
                && repository.find_blob(id).is_ok()
            {
                needed.add_blob(id, &conflict.path);
            }
        }
        // Content used both as an attachment and elsewhere is packed.
        needed.loose.retain(|id| !needed.packed.contains(id));
        Ok(needed)
    }
}

/// Where Git keeps the loose file of object `id`.
fn loose_path(objects: &Path, id: Oid) -> std::path::PathBuf {
    let hex = id.to_string();
    objects.join(&hex[..2]).join(&hex[2..])
}

/// Writes blob `id` as a loose file, when it's only in a pack (it came with
/// a sync, or was packed before attachments stayed loose).
fn keep_loose(repository: &Repository, objects: &Path, id: Oid) -> Result<(), String> {
    let path = loose_path(objects, id);
    if path.exists() {
        return Ok(());
    }
    let blob = repository
        .find_blob(id)
        .map_err(|e| git_error("Failed to read history", e))?;
    let folder = path.parent().expect("a loose object has a folder");
    let temp = folder.join(format!(".{}.netherstone-tmp", id));
    let written = std::fs::create_dir_all(folder)
        .and_then(|()| {
            let mut encoder = flate2::write::ZlibEncoder::new(
                std::fs::File::create(&temp)?,
                flate2::Compression::default(),
            );
            write!(encoder, "blob {}\0", blob.size())?;
            encoder.write_all(blob.content())?;
            encoder.finish()?.sync_all()
        })
        .and_then(|()| std::fs::rename(&temp, &path));
    if let Err(e) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Failed to pack history: {}", e));
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

    let (new_pack, loose) = {
        let repository = Repository::open(git_dir)
            .map_err(|e| git_error("Failed to open sync repository", e))?;
        let needed = Needed::find(&repository, record)?;
        if needed.packed.is_empty() {
            return Ok(Packed {
                bytes_before,
                bytes_after: bytes_before,
            });
        }
        for id in &needed.loose {
            keep_loose(&repository, &objects, *id)?;
        }
        let mut builder = repository
            .packbuilder()
            .map_err(|e| git_error("Failed to pack history", e))?;
        for (id, path) in &needed.order {
            builder
                .insert_object(*id, path.as_deref())
                .map_err(|e| git_error("Failed to pack history", e))?;
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
        let loose: HashSet<String> = needed.loose.iter().map(Oid::to_string).collect();
        (format!("pack-{}", name), loose)
    };

    // The new pack and the attachments' loose files hold everything needed;
    // the rest goes.
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
        let Some(folder) = entry
            .file_name()
            .to_str()
            .filter(|name| is_loose_folder(name))
            .map(String::from)
        else {
            continue;
        };
        let mut kept = false;
        for file in std::fs::read_dir(entry.path())
            .into_iter()
            .flatten()
            .flatten()
        {
            let id = format!("{}{}", folder, file.file_name().to_string_lossy());
            if loose.contains(&id) {
                kept = true;
            } else {
                remove(&file.path());
            }
        }
        if !kept {
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
    fn attachments_stay_loose_files() {
        let dir = temp_dir("pack-attachments");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(vault.join("_attachments")).unwrap();
        fs::write(vault.join("Note.md"), "Text").unwrap();
        fs::write(vault.join("_attachments/Old.png"), b"old picture").unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();
        fs::write(vault.join("_attachments/New.png"), b"new picture").unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();
        let record = state::find_record(&sync_root, &vault).unwrap().unwrap();
        let git_dir = state::git_dir(&sync_root, &record.vault_id);
        let objects = git_dir.join("objects");
        let (old, new) = (
            Oid::hash_object(ObjectType::Blob, b"old picture").unwrap(),
            Oid::hash_object(ObjectType::Blob, b"new picture").unwrap(),
        );

        // An attachment that came packed, as a sync downloads them.
        {
            let repository = Repository::open(&git_dir).unwrap();
            let mut builder = repository.packbuilder().unwrap();
            builder.insert_object(old, None).unwrap();
            builder.write(&objects.join("pack"), 0o644).unwrap();
        }
        fs::remove_file(loose_path(&objects, old)).unwrap();

        pack_vault(&sync_root, &vault).unwrap();
        assert!(loose_path(&objects, old).is_file());
        assert!(loose_path(&objects, new).is_file());
        assert_eq!(loose_count(&git_dir), 2);
        let repository = Repository::open(&git_dir).unwrap();
        assert_eq!(repository.find_blob(old).unwrap().content(), b"old picture");
        assert_eq!(repository.find_blob(new).unwrap().content(), b"new picture");
        let packs = fs::read_dir(objects.join("pack"))
            .unwrap()
            .flatten()
            .filter(|e| e.path().extension().is_some_and(|ext| ext == "pack"))
            .count();
        assert_eq!(packs, 1);
    }

    #[test]
    fn versions_saved_during_a_pack_dont_start_another() {
        let dir = temp_dir("pack-once");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "Text").unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();

        let packs: Vec<_> = (0..2)
            .map(|_| {
                let (sync_root, vault) = (sync_root.clone(), vault.clone());
                std::thread::spawn(move || pack_if_due(&sync_root, &vault).unwrap())
            })
            .collect();
        let ran = packs
            .into_iter()
            .filter_map(|pack| pack.join().unwrap())
            .count();
        assert_eq!(ran, 1);
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
