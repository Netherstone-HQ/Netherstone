//! Bringing changes from GitHub into the vault.
//!
//! Drawings changed on both sides are merged shape by shape. Otherwise the
//! vault keeps this device's version when both sides changed the same file:
//! the other version is recorded as a conflict (its blob stays in the
//! history), so nothing is lost and the user decides later. Sync never
//! stops on a conflict and never writes conflict markers into a note.

use super::drawing_merge;
use super::state::DEFAULT_BRANCH;
use git2::{Commit, ErrorCode, IndexEntry, ObjectType, Oid, Repository, Tree};
use std::path::{Component, Path};

/// Stage bits of an index entry's flags (`GIT_INDEX_ENTRY_STAGEMASK`).
const INDEX_STAGE_MASK: u16 = 0x3000;

fn git_error(context: &str, e: git2::Error) -> String {
    format!("{}: {}", context, e.message())
}

/// A file changed both here and on GitHub. The vault has this device's
/// version; `theirs` is the GitHub version's blob.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IncomingConflict {
    pub path: String,
    pub theirs: Oid,
}

#[derive(Debug, Default)]
pub struct Integration {
    /// Vault-relative paths written or removed in the vault.
    pub changed: Vec<String>,
    pub conflicts: Vec<IncomingConflict>,
}

fn head_commit(repository: &Repository) -> Result<Option<Commit<'_>>, String> {
    match repository.head() {
        Ok(head) => head
            .peel_to_commit()
            .map(Some)
            .map_err(|e| git_error("Failed to read last backup", e)),
        Err(e) if matches!(e.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => Ok(None),
        Err(e) => Err(git_error("Failed to read last backup", e)),
    }
}

/// Brings the commit `remote` (GitHub's latest) into the local branch and the
/// vault folder. Local changes must already be committed.
pub fn integrate(
    repository: &Repository,
    vault_path: &Path,
    remote: Oid,
) -> Result<Integration, String> {
    let local = head_commit(repository)?;
    let remote_commit = repository
        .find_commit(remote)
        .map_err(|e| git_error("Couldn't read your vault on GitHub", e))?;

    let descends = |a: Oid, b: Oid| {
        repository
            .graph_descendant_of(a, b)
            .map_err(|e| git_error("Couldn't check GitHub for changes", e))
    };

    let (target, mut conflicts) = match &local {
        None => (remote, Vec::new()),
        Some(local) if local.id() == remote || descends(local.id(), remote)? => {
            return Ok(Integration::default());
        }
        Some(local) if descends(remote, local.id())? => (remote, Vec::new()),
        Some(local) => merge_diverged(repository, local, &remote_commit)?,
    };

    let old_tree = match &local {
        Some(commit) => Some(
            commit
                .tree()
                .map_err(|e| git_error("Failed to read last backup", e))?,
        ),
        None => None,
    };
    let new_tree = repository
        .find_commit(target)
        .and_then(|commit| commit.tree())
        .map_err(|e| git_error("Failed to read merged backup", e))?;

    let mut integration = apply_to_vault(repository, vault_path, old_tree.as_ref(), &new_tree)?;
    integration.conflicts.append(&mut conflicts);

    repository
        .reference(
            &format!("refs/heads/{}", DEFAULT_BRANCH),
            target,
            true,
            "Bring in changes from GitHub",
        )
        .map_err(|e| git_error("Failed to update backup history", e))?;
    let mut index = repository
        .index()
        .map_err(|e| git_error("Failed to read sync index", e))?;
    index
        .read_tree(&new_tree)
        .and_then(|_| index.write())
        .map_err(|e| git_error("Failed to update sync index", e))?;

    Ok(integration)
}

/// Merges two histories that both moved on. Where a file changed on both
/// sides (in a drawing, the same shape), this device's version goes into the
/// merge and GitHub's is reported.
fn merge_diverged(
    repository: &Repository,
    local: &Commit<'_>,
    remote: &Commit<'_>,
) -> Result<(Oid, Vec<IncomingConflict>), String> {
    let mut index = repository
        .merge_commits(local, remote, None)
        .map_err(|e| git_error("Couldn't bring in changes from GitHub", e))?;

    let mut conflicts = Vec::new();
    if index.has_conflicts() {
        let entries = index
            .conflicts()
            .and_then(|iter| iter.collect::<Result<Vec<_>, _>>())
            .map_err(|e| git_error("Failed to read merge conflicts", e))?;

        for entry in entries {
            let Some(path) = [&entry.our, &entry.their, &entry.ancestor]
                .into_iter()
                .flatten()
                .next()
                .map(|e| String::from_utf8_lossy(&e.path).to_string())
            else {
                continue;
            };

            // A file deleted on one side and edited on the other keeps the edit.
            let chosen = match (entry.our, entry.their) {
                (Some(ours), Some(theirs)) => {
                    match merge_drawing(repository, &path, entry.ancestor.as_ref(), &ours, &theirs)? {
                        Some((id, file_size)) => Some(IndexEntry { id, file_size, ..ours }),
                        None => {
                            conflicts.push(IncomingConflict {
                                path: path.clone(),
                                theirs: theirs.id,
                            });
                            Some(ours)
                        }
                    }
                }
                (ours, theirs) => ours.or(theirs),
            };

            index
                .conflict_remove(Path::new(&path))
                .map_err(|e| git_error("Failed to resolve merge", e))?;
            if let Some(mut chosen) = chosen {
                chosen.flags &= !INDEX_STAGE_MASK;
                index
                    .add(&chosen)
                    .map_err(|e| git_error("Failed to resolve merge", e))?;
            }
        }
    }

    let tree_id = index
        .write_tree_to(repository)
        .map_err(|e| git_error("Failed to write merged backup", e))?;
    let tree = repository
        .find_tree(tree_id)
        .map_err(|e| git_error("Failed to write merged backup", e))?;
    let (author, committer) = super::repo::signatures()?;
    let id = repository
        .commit(
            None,
            &author,
            &committer,
            "Sync: merge changes from another device",
            &tree,
            &[local, remote],
        )
        .map_err(|e| git_error("Failed to save merged backup", e))?;

    Ok((id, conflicts))
}

/// A drawing changed on both sides, merged shape by shape: the merged blob
/// and its size. None when it isn't a drawing, or the same shape changed on
/// both sides.
fn merge_drawing(
    repository: &Repository,
    path: &str,
    ancestor: Option<&IndexEntry>,
    ours: &IndexEntry,
    theirs: &IndexEntry,
) -> Result<Option<(Oid, u32)>, String> {
    if !crate::vault::is_drawing_path(Path::new(path)) {
        return Ok(None);
    }
    let read = |id: Oid| {
        repository
            .find_blob(id)
            .map(|blob| String::from_utf8_lossy(blob.content()).into_owned())
            .map_err(|e| git_error("Failed to read merge conflicts", e))
    };
    let base = ancestor.map(|entry| read(entry.id)).transpose()?.unwrap_or_default();
    let Some(merged) = drawing_merge::merge(&base, &read(ours.id)?, &read(theirs.id)?)
        .filter(|merged| !merged.conflicted)
    else {
        return Ok(None);
    };
    let id = repository
        .blob(merged.content.as_bytes())
        .map_err(|e| git_error("Failed to resolve merge", e))?;
    Ok(Some((id, merged.content.len() as u32)))
}

/// Only plain relative paths are written: no `..`, no absolute paths, and
/// nothing hidden (such as `.netherstone/`), which the planner never uploads.
fn is_safe_vault_path(path: &Path) -> bool {
    path.components().all(|component| match component {
        Component::Normal(name) => !name.to_string_lossy().starts_with('.'),
        _ => false,
    })
}

fn disk_blob_id(path: &Path) -> Result<Option<Oid>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Oid::hash_object(ObjectType::Blob, &bytes)
            .map(Some)
            .map_err(|e| git_error("Failed to read vault file", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read {}: {}", path.display(), e)),
    }
}

/// Removes now-empty folders between `path` and the vault root.
fn prune_empty_parents(vault_path: &Path, path: &Path) {
    let mut dir = path.parent();
    while let Some(current) = dir {
        if current == vault_path || std::fs::remove_dir(current).is_err() {
            break;
        }
        dir = current.parent();
    }
}

/// Writes the difference between `old` and `new` into the vault.
///
/// A file only changes on disk if it still matches `old`, i.e. it wasn't
/// edited since the last snapshot. An edited file is left alone; if GitHub
/// changed it too, that's reported as a conflict.
fn apply_to_vault(
    repository: &Repository,
    vault_path: &Path,
    old: Option<&Tree<'_>>,
    new: &Tree<'_>,
) -> Result<Integration, String> {
    let diff = repository
        .diff_tree_to_tree(old, Some(new), None)
        .map_err(|e| git_error("Couldn't check GitHub for changes", e))?;

    let mut integration = Integration::default();
    for delta in diff.deltas() {
        let Some(relative) = delta.new_file().path().or(delta.old_file().path()) else {
            continue;
        };
        if !is_safe_vault_path(relative) {
            continue;
        }
        let relative_str = relative.to_string_lossy().replace('\\', "/");
        let path = vault_path.join(relative);
        let (old_id, new_id) = (delta.old_file().id(), delta.new_file().id());

        // Checked and written under one lock, so a save can't land in between.
        let writes = crate::locks::vault_writes()?;
        let on_disk = disk_blob_id(&path)?;
        let expected = (!old_id.is_zero()).then_some(old_id);
        let incoming = (!new_id.is_zero()).then_some(new_id);
        if on_disk == incoming {
            continue;
        }
        if on_disk != expected {
            // Edited here since the snapshot. Keep it; report GitHub's version.
            if let Some(theirs) = incoming {
                integration.conflicts.push(IncomingConflict {
                    path: relative_str,
                    theirs,
                });
            }
            continue;
        }

        match incoming {
            Some(id) => {
                let blob = repository
                    .find_blob(id)
                    .map_err(|e| git_error("Couldn't read a file from GitHub", e))?;
                crate::vault::write_with_folders(&writes, &path, blob.content())?;
            }
            None => {
                std::fs::remove_file(&path)
                    .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
                prune_empty_parents(vault_path, &path);
            }
        }
        integration.changed.push(relative_str);
    }

    Ok(integration)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::planner::plan_vault;
    use crate::sync::remote::{fetch, push, set_remote};
    use crate::sync::repo::{commit_plan, open_or_init};
    use crate::sync::state::tests::temp_dir;
    use std::fs;
    use std::path::PathBuf;

    /// A vault with its own sync repository, connected to a shared bare
    /// repository that stands in for GitHub.
    struct Device {
        vault: PathBuf,
        repository: Repository,
    }

    impl Device {
        fn new(dir: &Path, name: &str, remote: &Path) -> Self {
            let vault = dir.join(name);
            fs::create_dir_all(&vault).unwrap();
            let repository = open_or_init(&dir.join(format!("{}-git", name)), &vault).unwrap();
            set_remote(&repository, remote.to_str().unwrap()).unwrap();
            Self { vault, repository }
        }

        fn write(&self, relative: &str, contents: &str) {
            let path = self.vault.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }

        fn read(&self, relative: &str) -> Option<String> {
            fs::read_to_string(self.vault.join(relative)).ok()
        }

        /// One sync cycle: snapshot, download and merge, upload.
        fn sync(&self) -> Integration {
            commit_plan(&self.repository, &plan_vault(&self.vault).unwrap()).unwrap();
            let integration = match fetch(&self.repository, "token").unwrap() {
                Some(remote) => integrate(&self.repository, &self.vault, remote).unwrap(),
                None => Integration::default(),
            };
            commit_plan(&self.repository, &plan_vault(&self.vault).unwrap()).unwrap();
            push(&self.repository, "token").unwrap();
            integration
        }
    }

    fn setup(name: &str) -> (PathBuf, PathBuf) {
        let dir = temp_dir(name);
        let remote = dir.join("remote.git");
        Repository::init_bare(&remote).unwrap();
        (dir, remote)
    }

    #[test]
    fn brings_new_edited_and_deleted_files_to_another_device() {
        let (dir, remote) = setup("merge-ff");
        let laptop = Device::new(&dir, "laptop", &remote);
        let desktop = Device::new(&dir, "desktop", &remote);

        laptop.write("A.md", "a");
        laptop.write("Folder/B.md", "b");
        laptop.write("_attachments/pic.png", "png");
        laptop.sync();

        let pulled = desktop.sync();
        assert_eq!(pulled.changed.len(), 3);
        assert_eq!(desktop.read("Folder/B.md").as_deref(), Some("b"));
        assert_eq!(desktop.read("_attachments/pic.png").as_deref(), Some("png"));

        laptop.write("A.md", "a, edited");
        fs::remove_file(laptop.vault.join("Folder/B.md")).unwrap();
        laptop.sync();

        let pulled = desktop.sync();
        assert_eq!(pulled.changed, vec!["A.md", "Folder/B.md"]);
        assert!(pulled.conflicts.is_empty());
        assert_eq!(desktop.read("A.md").as_deref(), Some("a, edited"));
        assert!(!desktop.vault.join("Folder").exists());
    }

    #[test]
    fn merges_changes_to_different_files() {
        let (dir, remote) = setup("merge-diverged");
        let laptop = Device::new(&dir, "laptop", &remote);
        let desktop = Device::new(&dir, "desktop", &remote);
        laptop.write("Shared.md", "shared");
        laptop.sync();
        desktop.sync();

        laptop.write("Laptop.md", "from laptop");
        laptop.sync();
        desktop.write("Desktop.md", "from desktop");
        let pulled = desktop.sync();

        assert_eq!(pulled.changed, vec!["Laptop.md"]);
        assert!(pulled.conflicts.is_empty());
        laptop.sync();
        for device in [&laptop, &desktop] {
            assert_eq!(device.read("Laptop.md").as_deref(), Some("from laptop"));
            assert_eq!(device.read("Desktop.md").as_deref(), Some("from desktop"));
        }
    }

    #[test]
    fn keeps_this_devices_version_and_reports_a_conflict() {
        let (dir, remote) = setup("merge-conflict");
        let laptop = Device::new(&dir, "laptop", &remote);
        let desktop = Device::new(&dir, "desktop", &remote);
        laptop.write("Note.md", "original");
        laptop.sync();
        desktop.sync();

        laptop.write("Note.md", "laptop version");
        laptop.sync();
        desktop.write("Note.md", "desktop version");
        let pulled = desktop.sync();

        assert!(pulled.changed.is_empty());
        assert_eq!(pulled.conflicts.len(), 1);
        assert_eq!(pulled.conflicts[0].path, "Note.md");
        let theirs = desktop
            .repository
            .find_blob(pulled.conflicts[0].theirs)
            .unwrap();
        assert_eq!(theirs.content(), b"laptop version");
        assert_eq!(desktop.read("Note.md").as_deref(), Some("desktop version"));

        // The merge went up, so the laptop now gets the desktop's version.
        laptop.sync();
        assert_eq!(laptop.read("Note.md").as_deref(), Some("desktop version"));
    }

    #[test]
    fn merges_a_drawing_shape_by_shape() {
        let (dir, remote) = setup("merge-drawing");
        let laptop = Device::new(&dir, "laptop", &remote);
        let desktop = Device::new(&dir, "desktop", &remote);
        let shape = |id: &str, version: i64| {
            format!(r#"{{ "id": "{id}", "type": "rectangle", "version": {version}, "versionNonce": {version} }}"#)
        };
        let drawing = |shapes: &[String]| format!(r#"{{ "elements": [{}] }}"#, shapes.join(", "));
        let ids = |device: &Device| {
            let value: serde_json::Value =
                serde_json::from_str(&device.read("Plan.excalidraw").unwrap()).unwrap();
            value["elements"]
                .as_array()
                .unwrap()
                .iter()
                .map(|shape| format!("{}{}", shape["id"].as_str().unwrap(), shape["version"]))
                .collect::<Vec<_>>()
        };
        laptop.write("Plan.excalidraw", &drawing(&[shape("a", 1), shape("b", 1)]));
        laptop.sync();
        desktop.sync();

        laptop.write("Plan.excalidraw", &drawing(&[shape("a", 2), shape("b", 1), shape("laptop", 1)]));
        laptop.sync();
        desktop.write("Plan.excalidraw", &drawing(&[shape("a", 1), shape("b", 2), shape("desktop", 1)]));
        let pulled = desktop.sync();

        assert!(pulled.conflicts.is_empty());
        assert_eq!(ids(&desktop), ["a2", "b2", "laptop1", "desktop1"]);
        laptop.sync();
        assert_eq!(ids(&laptop), ids(&desktop));

        // The same shape changed on both: a conflict, as for a shard.
        laptop.write("Plan.excalidraw", &drawing(&[shape("a", 3)]));
        laptop.sync();
        desktop.write("Plan.excalidraw", &drawing(&[shape("a", 4)]));
        let pulled = desktop.sync();
        assert_eq!(pulled.conflicts.len(), 1);
        assert_eq!(ids(&desktop), ["a4"]);
    }

    #[test]
    fn an_edit_wins_over_a_deletion() {
        let (dir, remote) = setup("merge-delete");
        let laptop = Device::new(&dir, "laptop", &remote);
        let desktop = Device::new(&dir, "desktop", &remote);
        laptop.write("Note.md", "original");
        laptop.sync();
        desktop.sync();

        fs::remove_file(laptop.vault.join("Note.md")).unwrap();
        laptop.sync();
        desktop.write("Note.md", "still needed");
        let pulled = desktop.sync();

        assert!(pulled.conflicts.is_empty());
        assert_eq!(desktop.read("Note.md").as_deref(), Some("still needed"));
        laptop.sync();
        assert_eq!(laptop.read("Note.md").as_deref(), Some("still needed"));
    }

    #[test]
    fn joins_two_vaults_that_started_separately() {
        let (dir, remote) = setup("merge-unrelated");
        let laptop = Device::new(&dir, "laptop", &remote);
        let desktop = Device::new(&dir, "desktop", &remote);
        laptop.write("Laptop.md", "l");
        laptop.write("Same.md", "laptop");
        laptop.sync();
        desktop.write("Desktop.md", "d");
        desktop.write("Same.md", "desktop");

        let pulled = desktop.sync();
        assert_eq!(pulled.changed, vec!["Laptop.md"]);
        assert_eq!(pulled.conflicts.len(), 1);
        assert_eq!(desktop.read("Same.md").as_deref(), Some("desktop"));
        assert_eq!(desktop.read("Laptop.md").as_deref(), Some("l"));
    }

    #[test]
    fn never_writes_hidden_or_escaping_paths() {
        assert!(is_safe_vault_path(Path::new("Folder/Note.md")));
        assert!(!is_safe_vault_path(Path::new("../outside.md")));
        assert!(!is_safe_vault_path(Path::new(".netherstone/vault-id")));
        assert!(!is_safe_vault_path(Path::new("/etc/passwd")));
    }
}
