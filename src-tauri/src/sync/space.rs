//! Free up space: removing old versions of attachments from the history.
//!
//! An old version is an attachment's content that no longer is in the vault:
//! a deleted file, or what a replaced file held before. Shards and drawings
//! are never removed. Removing rewrites every version without those files,
//! keeping its date, its device, its notes and every other file, so a
//! rewrite of the same versions with the same files removed is the same on
//! every device. That's how other devices follow: the ids removed are kept
//! under `refs/netherstone/freed` and uploaded with the new history, and a
//! device whose sync finds ids it hasn't removed yet removes them from its
//! own history first, which then matches GitHub's again. It only removes
//! content its history held as attachments, whatever the list says.

use super::{changes, pack, repo, state};
use git2::{ObjectType, Oid, Repository, Signature, Sort, Tree};
use serde::Serialize;
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

/// The ids this device removed, as a commit whose tree holds `freed`.
pub const FREED_PREFIX: &str = "refs/netherstone/";
const FREED_REF: &str = "refs/netherstone/freed";
/// GitHub's list, as the last sync downloaded it.
pub const REMOTE_FREED_PREFIX: &str = "refs/netherstone-remote/";
const REMOTE_FREED_REF: &str = "refs/netherstone-remote/freed";
const FREED_FILE: &str = "freed";
/// Where the new history and list wait while they're uploaded.
const REWRITTEN_REF: &str = "refs/netherstone-rewritten/main";
const REWRITTEN_FREED_REF: &str = "refs/netherstone-rewritten/freed";

fn git_error(context: &str, e: git2::Error) -> String {
    format!("{}: {}", context, e.message())
}

fn read_error(e: git2::Error) -> String {
    git_error("Failed to read history", e)
}

/// An attachment with old versions in the history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OldAttachment {
    /// Vault-relative, as the newest of its old versions was named.
    pub path: String,
    /// What its old versions take, counted once each.
    pub size_bytes: u64,
    /// Its old versions, as blob ids.
    pub blobs: Vec<String>,
}

fn reference_target(repository: &Repository, name: &str) -> Option<Oid> {
    repository
        .find_reference(name)
        .ok()
        .and_then(|reference| reference.target())
}

fn branch_ref() -> String {
    format!("refs/heads/{}", state::DEFAULT_BRANCH)
}

fn remote_branch_ref() -> String {
    format!("refs/remotes/origin/{}", state::DEFAULT_BRANCH)
}

/// The branch and GitHub's copy of it, the versions every list starts from.
fn heads(repository: &Repository) -> Vec<Oid> {
    [branch_ref(), remote_branch_ref()]
        .iter()
        .filter_map(|name| reference_target(repository, name))
        .collect()
}

fn blobs_in(tree: &Tree, into: &mut HashSet<Oid>) -> Result<(), String> {
    tree.walk(git2::TreeWalkMode::PreOrder, |_, entry| {
        if entry.kind() == Some(ObjectType::Blob) {
            into.insert(entry.id());
        }
        git2::TreeWalkResult::Ok
    })
    .map_err(read_error)?;
    Ok(())
}

/// Content that must stay: the vault as it is in the newest version here and
/// on GitHub, what the index stages, and the other side of every conflict.
fn kept_blobs(
    repository: &Repository,
    record: &state::VaultSyncRecord,
) -> Result<HashSet<Oid>, String> {
    let mut kept = HashSet::new();
    for head in heads(repository) {
        let tree = repository
            .find_commit(head)
            .and_then(|commit| commit.tree())
            .map_err(read_error)?;
        blobs_in(&tree, &mut kept)?;
    }
    let index = repository.index().map_err(read_error)?;
    kept.extend(index.iter().map(|entry| entry.id));
    kept.extend(
        record
            .conflicts
            .iter()
            .filter_map(|conflict| Oid::from_str(&conflict.theirs).ok()),
    );
    Ok(kept)
}

fn is_attachment(path: &str) -> bool {
    path.starts_with(&format!(
        "{}/",
        crate::db::attachments::ATTACHMENTS_DIR_NAME
    ))
}

fn find_old_attachments(
    repository: &Repository,
    record: &state::VaultSyncRecord,
) -> Result<Vec<OldAttachment>, String> {
    let kept = kept_blobs(repository, record)?;
    let odb = repository.odb().map_err(read_error)?;
    let mut by_path: HashMap<String, (u64, Vec<Oid>)> = HashMap::new();
    let mut seen = HashSet::new();
    // Newest first, so a file is named as it was last.
    let mut versions = changes::every_version(repository, &heads(repository))?;
    versions.sort_by_key(|version| std::cmp::Reverse(version.time));
    for version in versions {
        for change in &version.changes {
            let Some(blob) = change.after else { continue };
            if !is_attachment(&change.path) || kept.contains(&blob) || !seen.insert(blob) {
                continue;
            }
            let size = odb
                .read_header(blob)
                .map(|(size, _)| size as u64)
                .unwrap_or(0);
            let entry = by_path.entry(change.path.clone()).or_default();
            entry.0 += size;
            entry.1.push(blob);
        }
    }
    let mut old: Vec<OldAttachment> = by_path
        .into_iter()
        .map(|(path, (size_bytes, blobs))| OldAttachment {
            path,
            size_bytes,
            blobs: blobs.iter().map(Oid::to_string).collect(),
        })
        .collect();
    old.sort_by(|a, b| {
        b.size_bytes
            .cmp(&a.size_bytes)
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(old)
}

/// The vault's attachments with old versions in the history, biggest first.
pub fn old_attachments(sync_root: &Path, vault_path: &Path) -> Result<Vec<OldAttachment>, String> {
    let Some(record) = state::find_record(sync_root, vault_path)? else {
        return Ok(Vec::new());
    };
    let Some(repository) = super::history::open_existing(sync_root, vault_path)? else {
        return Ok(Vec::new());
    };
    find_old_attachments(&repository, &record)
}

/// Content the history only ever held as attachments, never as a shard,
/// drawing or other file.
fn attachment_only_blobs(repository: &Repository) -> Result<HashSet<Oid>, String> {
    let mut attachments = HashSet::new();
    let mut elsewhere = HashSet::new();
    for version in changes::every_version(repository, &heads(repository))? {
        for change in &version.changes {
            let Some(blob) = change.after else { continue };
            if is_attachment(&change.path) {
                attachments.insert(blob);
            } else {
                elsewhere.insert(blob);
            }
        }
    }
    Ok(&attachments - &elsewhere)
}

/// The ids in the list `reference` points at.
fn freed_list(repository: &Repository, reference: &str) -> Result<BTreeSet<Oid>, String> {
    let Some(target) = reference_target(repository, reference) else {
        return Ok(BTreeSet::new());
    };
    let tree = repository
        .find_commit(target)
        .and_then(|commit| commit.tree())
        .map_err(read_error)?;
    let Some(entry) = tree.get_name(FREED_FILE) else {
        return Ok(BTreeSet::new());
    };
    let blob = repository.find_blob(entry.id()).map_err(read_error)?;
    Ok(String::from_utf8_lossy(blob.content())
        .lines()
        .filter_map(|line| Oid::from_str(line.trim()).ok())
        .collect())
}

/// Commits `list` as the new freed list, on top of the one `previous` points
/// at, and returns its commit.
fn commit_freed_list(
    repository: &Repository,
    list: &BTreeSet<Oid>,
    previous: Option<Oid>,
) -> Result<Oid, String> {
    let write = |e| git_error("Failed to save what was freed", e);
    let text: String = list.iter().map(|id| format!("{}\n", id)).collect();
    let blob = repository.blob(text.as_bytes()).map_err(write)?;
    let mut builder = repository.treebuilder(None).map_err(write)?;
    builder.insert(FREED_FILE, blob, 0o100644).map_err(write)?;
    let tree = repository
        .find_tree(builder.write().map_err(write)?)
        .map_err(write)?;
    let signature = Signature::now("Netherstone", "backup@netherstone.app").map_err(write)?;
    let parents: Vec<_> = previous
        .and_then(|id| repository.find_commit(id).ok())
        .into_iter()
        .collect();
    let parents: Vec<_> = parents.iter().collect();
    repository
        .commit(
            None,
            &signature,
            &signature,
            "Freed up space",
            &tree,
            &parents,
        )
        .map_err(write)
}

/// Writes `tree` again without the blobs in `drop`, leaving out folders that
/// end up empty. `None` when nothing is left.
fn without(
    repository: &Repository,
    tree: &Tree,
    drop: &HashSet<Oid>,
    done: &mut HashMap<Oid, Option<Oid>>,
) -> Result<Option<Oid>, String> {
    if let Some(id) = done.get(&tree.id()) {
        return Ok(*id);
    }
    let write = |e| git_error("Failed to rewrite history", e);
    let mut builder = repository.treebuilder(None).map_err(write)?;
    let mut changed = false;
    for entry in tree.iter() {
        let id = match entry.kind() {
            Some(ObjectType::Blob) if drop.contains(&entry.id()) => None,
            Some(ObjectType::Tree) => {
                let subtree = repository.find_tree(entry.id()).map_err(read_error)?;
                without(repository, &subtree, drop, done)?
            }
            _ => Some(entry.id()),
        };
        changed |= id != Some(entry.id());
        if let (Some(id), Ok(name)) = (id, std::str::from_utf8(entry.name_bytes())) {
            builder.insert(name, id, entry.filemode()).map_err(write)?;
        }
    }
    let id = if !changed {
        Some(tree.id())
    } else if builder.is_empty() {
        None
    } else {
        Some(builder.write().map_err(write)?)
    };
    done.insert(tree.id(), id);
    Ok(id)
}

/// Writes every version reachable from `tips` again without the blobs in
/// `drop`, oldest first, and returns each old version's new id. A version
/// that held none of them keeps its id.
fn rewrite(
    repository: &Repository,
    tips: &[Oid],
    drop: &HashSet<Oid>,
) -> Result<HashMap<Oid, Oid>, String> {
    let write = |e| git_error("Failed to rewrite history", e);
    let mut walk = repository.revwalk().map_err(read_error)?;
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::REVERSE)
        .map_err(read_error)?;
    for tip in tips {
        walk.push(*tip).map_err(read_error)?;
    }
    let empty_tree = repository
        .treebuilder(None)
        .and_then(|builder| builder.write())
        .map_err(write)?;

    let mut trees = HashMap::new();
    let mut ids = HashMap::new();
    for id in walk {
        let commit = repository
            .find_commit(id.map_err(read_error)?)
            .map_err(read_error)?;
        let tree = commit.tree().map_err(read_error)?;
        let new_tree = without(repository, &tree, drop, &mut trees)?.unwrap_or(empty_tree);
        let parents: Vec<Oid> = commit
            .parent_ids()
            .map(|parent| ids.get(&parent).copied().unwrap_or(parent))
            .collect();
        let unchanged = new_tree == tree.id() && parents.iter().copied().eq(commit.parent_ids());
        let new_id = if unchanged {
            commit.id()
        } else {
            let parents = parents
                .iter()
                .map(|id| repository.find_commit(*id))
                .collect::<Result<Vec<_>, _>>()
                .map_err(read_error)?;
            let parents: Vec<_> = parents.iter().collect();
            let new_tree = repository.find_tree(new_tree).map_err(read_error)?;
            repository
                .commit(
                    None,
                    &commit.author(),
                    &commit.committer(),
                    commit.message_raw().unwrap_or_default(),
                    &new_tree,
                    &parents,
                )
                .map_err(write)?
        };
        ids.insert(commit.id(), new_id);
    }
    Ok(ids)
}

fn set_reference(repository: &Repository, name: &str, id: Oid) -> Result<(), String> {
    repository
        .reference(name, id, true, "Free up space")
        .map(|_| ())
        .map_err(|e| git_error("Failed to rewrite history", e))
}

/// Moves the branch and GitHub's copy of it to their rewritten versions.
fn switch_to(repository: &Repository, ids: &HashMap<Oid, Oid>) -> Result<(), String> {
    for name in [branch_ref(), remote_branch_ref()] {
        if let Some(old) = reference_target(repository, &name)
            && let Some(new) = ids.get(&old)
            && *new != old
        {
            set_reference(repository, &name, *new)?;
        }
    }
    Ok(())
}

/// How much Free up space freed: the size of the old versions it removed.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Freed {
    pub bytes: u64,
}

/// Removes the old versions `blobs` from the history, then packs it so their
/// space is freed. With sync on, `upload` replaces GitHub's history with the
/// new one first (with the list of what was removed); the local history only
/// changes once that worked. Run under the sync and history locks, with
/// GitHub's latest already brought in.
pub(super) fn free_locked(
    sync_root: &Path,
    vault_path: &Path,
    blobs: &[String],
    upload: Option<&dyn Fn(&Repository, &[&str]) -> Result<(), String>>,
) -> Result<Freed, String> {
    let record = state::load_or_create_record(sync_root, vault_path)?;
    let git_dir = state::git_dir(sync_root, &record.vault_id);
    let repository = repo::open_or_init(&git_dir, vault_path)?;

    // Only what's still an old version: never what the vault has now.
    let old: HashSet<Oid> = find_old_attachments(&repository, &record)?
        .iter()
        .flat_map(|attachment| attachment.blobs.iter())
        .filter_map(|id| Oid::from_str(id).ok())
        .collect();
    let drop: HashSet<Oid> = blobs
        .iter()
        .filter_map(|id| Oid::from_str(id).ok())
        .filter(|id| old.contains(id))
        .collect();
    if drop.is_empty() {
        return Ok(Freed { bytes: 0 });
    }
    let bytes = {
        let odb = repository.odb().map_err(read_error)?;
        drop.iter()
            .filter_map(|id| odb.read_header(*id).ok())
            .map(|(size, _)| size as u64)
            .sum()
    };

    let ids = rewrite(&repository, &heads(&repository), &drop)?;
    let previous = reference_target(&repository, FREED_REF);
    let mut list = freed_list(&repository, FREED_REF)?;
    list.extend(drop.iter().copied());
    let freed = commit_freed_list(&repository, &list, previous)?;

    if let Some(upload) = upload {
        let head = reference_target(&repository, &branch_ref())
            .and_then(|old| ids.get(&old).copied())
            .ok_or_else(|| "Failed to rewrite history".to_string())?;
        set_reference(&repository, REWRITTEN_REF, head)?;
        set_reference(&repository, REWRITTEN_FREED_REF, freed)?;
        let branch = format!("+{}:{}", REWRITTEN_REF, branch_ref());
        let list = format!("+{}:{}", REWRITTEN_FREED_REF, FREED_REF);
        let uploaded = upload(&repository, &[branch.as_str(), list.as_str()]);
        for name in [REWRITTEN_REF, REWRITTEN_FREED_REF] {
            let _ = repository
                .find_reference(name)
                .and_then(|mut reference| reference.delete());
        }
        uploaded?;
    }

    switch_to(&repository, &ids)?;
    set_reference(&repository, FREED_REF, freed)?;
    set_reference(&repository, REMOTE_FREED_REF, freed)?;
    let mut record = record;
    // Old versions and what's left of the old history go now.
    // Open handles would keep old packs from being removed on Windows.
    std::mem::drop(repository);
    pack::pack_repository(&git_dir, &record)?;
    let repository = repo::open_or_init(&git_dir, vault_path)?;
    let head = repo::head_commit(&repository)?;
    record.last_commit = head.as_ref().map(|commit| commit.id().to_string());
    record.last_packed_at = Some(super::now_unix_seconds());
    state::save_record(sync_root, &record)?;
    Ok(Freed { bytes })
}

/// After a sync downloaded GitHub's history: when another device freed up
/// space since this one last looked, removes the same old versions here, so
/// this history matches GitHub's again. Run under the history lock. Returns
/// whether anything changed.
pub(super) fn follow_freed(repository: &Repository) -> Result<bool, String> {
    let Some(theirs) = reference_target(repository, REMOTE_FREED_REF) else {
        return Ok(false);
    };
    if reference_target(repository, FREED_REF) == Some(theirs) {
        return Ok(false);
    }
    let ours = freed_list(repository, FREED_REF)?;
    // Only attachments are ever freed, so anything else on the list is
    // ignored: shards and drawings keep every version.
    let attachments = attachment_only_blobs(repository)?;
    let drop: HashSet<Oid> = freed_list(repository, REMOTE_FREED_REF)?
        .difference(&ours)
        .filter(|id| attachments.contains(id))
        .copied()
        .collect();
    if !drop.is_empty() {
        let ids = rewrite(repository, &heads(repository), &drop)?;
        switch_to(repository, &ids)?;
    }
    set_reference(repository, FREED_REF, theirs)?;
    Ok(!drop.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use std::fs;
    use std::path::PathBuf;

    struct Device {
        vault: PathBuf,
        sync_root: PathBuf,
    }

    impl Device {
        fn new(dir: &Path, name: &str) -> Device {
            let vault = dir.join(name);
            fs::create_dir_all(vault.join("_attachments")).unwrap();
            Device {
                vault,
                sync_root: dir.join(format!("{}-sync", name)),
            }
        }

        fn write(&self, path: &str, bytes: &[u8]) {
            fs::write(self.vault.join(path), bytes).unwrap();
        }

        fn save(&self) {
            crate::sync::snapshot_vault(&self.sync_root, &self.vault).unwrap();
        }

        fn sync(&self, remote: &Path) {
            crate::sync::sync_cycle(
                &self.sync_root,
                &self.vault,
                remote.to_str().unwrap(),
                "token",
            )
            .unwrap();
        }

        fn repository(&self) -> Repository {
            let record = state::find_record(&self.sync_root, &self.vault)
                .unwrap()
                .unwrap();
            repo::open_or_init(
                &state::git_dir(&self.sync_root, &record.vault_id),
                &self.vault,
            )
            .unwrap()
        }

        fn old(&self) -> Vec<OldAttachment> {
            old_attachments(&self.sync_root, &self.vault).unwrap()
        }

        fn shard_texts(&self) -> Vec<(i64, String)> {
            crate::sync::history::list_versions(
                &self.sync_root,
                &self.vault,
                &self.vault.join("Note.md"),
            )
            .unwrap()
            .versions
            .iter()
            .map(|version| {
                let text =
                    crate::sync::history::read_version(&self.sync_root, &self.vault, &version.blob)
                        .unwrap();
                (version.time, text)
            })
            .collect()
        }
    }

    fn all_blobs(old: &[OldAttachment]) -> Vec<String> {
        old.iter().flat_map(|a| a.blobs.clone()).collect()
    }

    #[test]
    fn lists_deleted_and_replaced_attachments_only() {
        let dir = temp_dir("space-list");
        let device = Device::new(&dir, "vault");
        device.write("Note.md", b"First");
        device.write("_attachments/pic.png", b"old picture");
        device.save();
        device.write("Note.md", b"Second");
        device.write("_attachments/pic.png", b"new picture");
        device.write("_attachments/gone.pdf", b"a pdf that goes");
        device.save();
        fs::remove_file(device.vault.join("_attachments/gone.pdf")).unwrap();
        device.save();

        let old = device.old();
        let paths: Vec<(&str, u64)> = old
            .iter()
            .map(|a| (a.path.as_str(), a.size_bytes))
            .collect();
        assert_eq!(
            paths,
            [("_attachments/gone.pdf", 15), ("_attachments/pic.png", 11)]
        );
    }

    #[test]
    fn frees_old_versions_and_keeps_everything_else() {
        let dir = temp_dir("space-free");
        let device = Device::new(&dir, "vault");
        device.write("Note.md", b"First");
        device.write("_attachments/pic.png", b"old picture");
        device.save();
        device.write("Note.md", b"Second");
        device.write("_attachments/pic.png", b"new picture");
        device.save();
        device.write("Note.md", b"Third");
        device.save();
        let texts = device.shard_texts();
        let old = device.old();
        let dropped = Oid::from_str(&old[0].blobs[0]).unwrap();

        let freed = crate::sync::free_up_space_now(
            &device.sync_root,
            &device.vault,
            &all_blobs(&old),
            None,
        )
        .unwrap();
        assert!(freed.bytes > 0);

        let repository = device.repository();
        assert!(repository.find_blob(dropped).is_err());
        assert!(device.old().is_empty());
        // Every version of the shard, with its date.
        assert_eq!(device.shard_texts(), texts);
        assert_eq!(
            fs::read(device.vault.join("_attachments/pic.png")).unwrap(),
            b"new picture"
        );
        // The first version no longer has the old picture.
        let versions = crate::sync::history::list_versions(
            &device.sync_root,
            &device.vault,
            &device.vault.join("Note.md"),
        )
        .unwrap()
        .versions;
        let first = repository
            .find_commit(Oid::from_str(&versions.last().unwrap().id).unwrap())
            .unwrap();
        assert!(
            first
                .tree()
                .unwrap()
                .get_path(Path::new("_attachments/pic.png"))
                .is_err()
        );

        // Nothing left to free.
        let again = crate::sync::free_up_space_now(
            &device.sync_root,
            &device.vault,
            &all_blobs(&old),
            None,
        )
        .unwrap();
        assert_eq!(again.bytes, 0);
    }

    #[test]
    fn never_frees_what_the_vault_has_now() {
        let dir = temp_dir("space-current");
        let device = Device::new(&dir, "vault");
        device.write("_attachments/pic.png", b"picture");
        device.save();
        let repository = device.repository();
        let current = repo::head_commit(&repository)
            .unwrap()
            .unwrap()
            .tree()
            .unwrap()
            .get_path(Path::new("_attachments/pic.png"))
            .unwrap()
            .id();

        crate::sync::free_up_space_now(
            &device.sync_root,
            &device.vault,
            &[current.to_string()],
            None,
        )
        .unwrap();
        assert!(device.repository().find_blob(current).is_ok());
    }

    #[test]
    fn a_list_naming_shard_versions_is_ignored() {
        let dir = temp_dir("space-shards");
        let remote = dir.join("remote.git");
        Repository::init_bare(&remote).unwrap();
        let laptop = Device::new(&dir, "laptop");
        laptop.write("Note.md", b"First");
        laptop.save();
        laptop.sync(&remote);
        laptop.write("Note.md", b"Second");
        laptop.save();
        laptop.sync(&remote);
        let texts = laptop.shard_texts();
        assert_eq!(texts.len(), 1);

        // GitHub's list names the shard's versions, with a history that
        // no longer has them.
        let github = Repository::open_bare(&remote).unwrap();
        let list: BTreeSet<Oid> = ["First", "Second"]
            .iter()
            .map(|text| Oid::hash_object(ObjectType::Blob, text.as_bytes()).unwrap())
            .collect();
        let freed = commit_freed_list(&github, &list, None).unwrap();
        github.reference(FREED_REF, freed, true, "Freed up space").unwrap();
        let mut builder = github.treebuilder(None).unwrap();
        builder
            .insert("Note.md", github.blob(b"Second").unwrap(), 0o100644)
            .unwrap();
        let tree = github.find_tree(builder.write().unwrap()).unwrap();
        let signature = Signature::now("Other", "other@example.com").unwrap();
        let fresh = github
            .commit(None, &signature, &signature, "Backup", &tree, &[])
            .unwrap();
        github
            .reference("refs/heads/main", fresh, true, "Backup")
            .unwrap();
        laptop.sync(&remote);

        assert_eq!(laptop.shard_texts(), texts);
        let repository = laptop.repository();
        for id in list {
            assert!(repository.find_blob(id).is_ok());
        }
    }

    #[test]
    fn other_devices_follow_on_their_next_sync() {
        let dir = temp_dir("space-devices");
        let remote = dir.join("remote.git");
        Repository::init_bare(&remote).unwrap();
        let desk = Device::new(&dir, "desk");
        let laptop = Device::new(&dir, "laptop");

        desk.write("Note.md", b"From the desk");
        desk.write("_attachments/pic.png", b"old picture");
        desk.save();
        desk.sync(&remote);
        laptop.sync(&remote);
        desk.write("_attachments/pic.png", b"new picture");
        desk.save();
        desk.sync(&remote);
        laptop.sync(&remote);
        let old = laptop.old();
        assert_eq!(old.len(), 1);
        let dropped = Oid::from_str(&old[0].blobs[0]).unwrap();

        crate::sync::free_up_space_now(
            &desk.sync_root,
            &desk.vault,
            &all_blobs(&desk.old()),
            Some((remote.to_str().unwrap(), "token")),
        )
        .unwrap();
        let github = Repository::open_bare(&remote).unwrap();
        let github_head = github
            .find_reference("refs/heads/main")
            .unwrap()
            .target()
            .unwrap();
        assert_eq!(
            repo::head_commit(&desk.repository()).unwrap().unwrap().id(),
            github_head
        );

        // Edited on the laptop before it heard about it.
        laptop.write("Note.md", b"From the laptop");
        laptop.save();
        laptop.sync(&remote);

        let laptop_repository = laptop.repository();
        assert!(laptop_repository.find_blob(dropped).is_err());
        assert!(laptop.old().is_empty());
        let laptop_head = repo::head_commit(&laptop_repository).unwrap().unwrap();
        // The laptop's edit went on top of the desk's new history.
        assert!(
            laptop_repository
                .graph_descendant_of(laptop_head.id(), github_head)
                .unwrap()
        );
        assert_eq!(
            github.find_reference("refs/heads/main").unwrap().target(),
            Some(laptop_head.id())
        );
        assert_eq!(
            fs::read(laptop.vault.join("Note.md")).unwrap(),
            b"From the laptop"
        );
        assert_eq!(
            fs::read(laptop.vault.join("_attachments/pic.png")).unwrap(),
            b"new picture"
        );
    }
}
