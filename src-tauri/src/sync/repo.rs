//! Local Git repository for a vault: metadata in AppData, vault as work tree.

use super::planner::SyncPlan;
use super::state::DEFAULT_BRANCH;
use git2::{
    Commit, Index, IndexAddOption, IndexEntry, IndexTime, Repository, RepositoryInitOptions,
    Signature, Tree,
};
use serde::Serialize;
use std::path::Path;

const COMMITTER_NAME: &str = "Netherstone";
const COMMITTER_EMAIL: &str = "backup@netherstone.app";

fn git_error(context: &str, e: git2::Error) -> String {
    format!("{}: {}", context, e.message())
}

/// Opens the vault's repository, creating it on first use.
///
/// The work tree is set on every open, so a vault that moved since the last
/// sync is still found. No `.git` file or folder is ever written into the vault.
pub fn open_or_init(git_dir: &Path, vault_path: &Path) -> Result<Repository, String> {
    let repository = if git_dir.join("HEAD").exists() {
        Repository::open(git_dir).map_err(|e| git_error("Failed to open sync repository", e))?
    } else {
        // Created bare and then given a work tree: initializing with a separate
        // work tree would make libgit2 drop a `.git` link file into the vault.
        let mut options = RepositoryInitOptions::new();
        options.bare(true).mkpath(true).initial_head(DEFAULT_BRANCH);
        let repository = Repository::init_opts(git_dir, &options)
            .map_err(|e| git_error("Failed to create sync repository", e))?;
        repository
            .config()
            .and_then(|mut config| config.set_bool("core.bare", false))
            .map_err(|e| git_error("Failed to configure sync repository", e))?;
        repository
    };

    repository
        .set_workdir(vault_path, false)
        .map_err(|e| git_error("Failed to attach vault to sync repository", e))?;

    Ok(repository)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotCommit {
    pub id: String,
    pub time: i64,
    pub added: usize,
    pub modified: usize,
    pub removed: usize,
}

/// Stages exactly the files in `plan` and commits them if anything changed.
///
/// Files that were committed before but are no longer in the plan (deleted,
/// or now excluded by policy) are removed from the next commit; they stay on
/// disk. Returns `None` when the vault matches the last commit.
pub fn commit_plan(
    repository: &Repository,
    plan: &SyncPlan,
) -> Result<Option<SnapshotCommit>, String> {
    let mut index = repository
        .index()
        .map_err(|e| git_error("Failed to read sync index", e))?;

    let path_str = |path: &Path| path.to_str().map(|p| p.replace('\\', "/"));

    // Drop entries the plan no longer includes. Callback: 0 = act, 1 = skip.
    index
        .remove_all(
            ["*"],
            Some(&mut |path: &Path, _: &[u8]| match path_str(path) {
                Some(path) if plan.includes(&path) => 1,
                _ => 0,
            }),
        )
        .map_err(|e| git_error("Failed to update sync index", e))?;

    // FORCE bypasses .gitignore files the vault may carry: the plan decides.
    // add_all reuses cached file stats, so unchanged files aren't re-hashed.
    index
        .add_all(
            ["*"],
            IndexAddOption::FORCE,
            Some(&mut |path: &Path, _: &[u8]| match path_str(path) {
                Some(path) if plan.includes(&path) => 0,
                _ => 1,
            }),
        )
        .map_err(|e| git_error("Failed to stage vault files", e))?;

    index
        .write()
        .map_err(|e| git_error("Failed to write sync index", e))?;
    let tree_id = index
        .write_tree()
        .map_err(|e| git_error("Failed to write sync tree", e))?;
    let tree = repository
        .find_tree(tree_id)
        .map_err(|e| git_error("Failed to read sync tree", e))?;

    let parent = head_commit(repository)?;
    let parent_tree = tree_of(parent.as_ref())?;

    if parent_tree.as_ref().map(|t| t.id()) == Some(tree_id) {
        return Ok(None);
    }

    let diff = repository
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), None)
        .map_err(|e| git_error("Failed to compare with last backup", e))?;
    let (mut added, mut modified, mut removed) = (0, 0, 0);
    for delta in diff.deltas() {
        match delta.status() {
            git2::Delta::Added => added += 1,
            git2::Delta::Deleted => removed += 1,
            _ => modified += 1,
        }
    }
    if parent.is_none() && added == 0 {
        // Nothing to back up yet: don't create an empty first commit.
        return Ok(None);
    }

    commit_tree(
        repository,
        &tree,
        parent.as_ref(),
        (added, modified, removed),
    )
    .map(Some)
}

/// Commits `bytes` as the vault file `path` on top of the last version, with
/// every other file as it was there. Returns `None` when the last version
/// already holds those bytes.
pub fn commit_file_version(
    repository: &Repository,
    path: &str,
    bytes: &[u8],
) -> Result<Option<SnapshotCommit>, String> {
    let parent = head_commit(repository)?;
    let parent_tree = tree_of(parent.as_ref())?;

    // A separate index, so the repository's own (and its cached file stats)
    // still describes the vault.
    let mut index = Index::new().map_err(|e| git_error("Failed to create index", e))?;
    if let Some(tree) = &parent_tree {
        index
            .read_tree(tree)
            .map_err(|e| git_error("Failed to read last backup", e))?;
    }
    let existed = index.get_path(Path::new(path), 0).is_some();
    let blob = repository
        .blob(bytes)
        .map_err(|e| git_error("Failed to save file version", e))?;
    index
        .add(&IndexEntry {
            ctime: IndexTime::new(0, 0),
            mtime: IndexTime::new(0, 0),
            dev: 0,
            ino: 0,
            mode: 0o100644,
            uid: 0,
            gid: 0,
            file_size: bytes.len() as u32,
            id: blob,
            flags: 0,
            flags_extended: 0,
            path: path.as_bytes().to_vec(),
        })
        .map_err(|e| git_error("Failed to save file version", e))?;
    let tree_id = index
        .write_tree_to(repository)
        .map_err(|e| git_error("Failed to write sync tree", e))?;
    if parent_tree.as_ref().map(|t| t.id()) == Some(tree_id) {
        return Ok(None);
    }
    let tree = repository
        .find_tree(tree_id)
        .map_err(|e| git_error("Failed to read sync tree", e))?;

    let counts = if existed { (0, 1, 0) } else { (1, 0, 0) };
    commit_tree(repository, &tree, parent.as_ref(), counts).map(Some)
}

fn head_commit(repository: &Repository) -> Result<Option<Commit<'_>>, String> {
    match repository.head() {
        Ok(head) => head
            .peel_to_commit()
            .map(Some)
            .map_err(|e| git_error("Failed to read last backup", e)),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Ok(None),
        Err(e) => Err(git_error("Failed to read last backup", e)),
    }
}

fn tree_of<'r>(commit: Option<&Commit<'r>>) -> Result<Option<Tree<'r>>, String> {
    commit
        .map(|commit| commit.tree())
        .transpose()
        .map_err(|e| git_error("Failed to read last backup", e))
}

fn commit_tree(
    repository: &Repository,
    tree: &Tree,
    parent: Option<&Commit>,
    (added, modified, removed): (usize, usize, usize),
) -> Result<SnapshotCommit, String> {
    let signature = Signature::now(COMMITTER_NAME, COMMITTER_EMAIL)
        .map_err(|e| git_error("Failed to create backup signature", e))?;
    let message = commit_message(added, modified, removed);
    let parents: Vec<_> = parent.into_iter().collect();
    let id = repository
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            tree,
            &parents,
        )
        .map_err(|e| git_error("Failed to save backup", e))?;

    Ok(SnapshotCommit {
        id: id.to_string(),
        time: signature.when().seconds(),
        added,
        modified,
        removed,
    })
}

fn commit_message(added: usize, modified: usize, removed: usize) -> String {
    let parts: Vec<String> = [
        (added, "added"),
        (modified, "changed"),
        (removed, "removed"),
    ]
    .into_iter()
    .filter(|(count, _)| *count > 0)
    .map(|(count, label)| format!("{} {}", count, label))
    .collect();
    format!("Backup: {}", parts.join(", "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::planner::plan_vault;
    use crate::sync::state::tests::temp_dir;
    use std::fs;

    fn snapshot(repository: &Repository, vault: &Path) -> Option<SnapshotCommit> {
        commit_plan(repository, &plan_vault(vault).unwrap()).unwrap()
    }

    fn committed_paths(repository: &Repository) -> Vec<String> {
        let tree = repository.head().unwrap().peel_to_tree().unwrap();
        let mut paths = Vec::new();
        tree.walk(git2::TreeWalkMode::PreOrder, |root, entry| {
            if entry.kind() == Some(git2::ObjectType::Blob) {
                paths.push(format!("{}{}", root, entry.name().unwrap()));
            }
            git2::TreeWalkResult::Ok
        })
        .unwrap();
        paths
    }

    #[test]
    fn keeps_git_metadata_out_of_the_vault() {
        let dir = temp_dir("repo-init");
        let (vault, git_dir) = (dir.join("vault"), dir.join("git"));
        fs::create_dir_all(&vault).unwrap();

        let repository = open_or_init(&git_dir, &vault).unwrap();
        assert!(!repository.is_bare());
        assert!(git_dir.join("HEAD").exists());
        assert!(!vault.join(".git").exists());
        assert_eq!(
            repository.workdir().unwrap().canonicalize().unwrap(),
            vault.canonicalize().unwrap()
        );

        // Reopening finds the vault, even after it moved.
        let moved = dir.join("moved");
        fs::rename(&vault, &moved).unwrap();
        let reopened = open_or_init(&git_dir, &moved).unwrap();
        assert_eq!(
            reopened.workdir().unwrap().canonicalize().unwrap(),
            moved.canonicalize().unwrap()
        );
    }

    #[test]
    fn commits_only_planned_files_and_tracks_changes() {
        let dir = temp_dir("repo-commit");
        let (vault, git_dir) = (dir.join("vault"), dir.join("git"));
        fs::create_dir_all(vault.join("_attachments")).unwrap();
        fs::write(vault.join("A.md"), "a").unwrap();
        fs::write(vault.join("B.md"), "b").unwrap();
        fs::write(vault.join("_attachments/pic.png"), "png").unwrap();
        fs::write(vault.join("_attachments/tool.exe"), "exe").unwrap();
        fs::write(vault.join("stray.txt"), "stray").unwrap();
        // A .gitignore in the vault must not override the plan.
        fs::write(vault.join(".gitignore"), "*.md\n").unwrap();

        let repository = open_or_init(&git_dir, &vault).unwrap();
        let first = snapshot(&repository, &vault).unwrap();
        assert_eq!((first.added, first.modified, first.removed), (3, 0, 0));
        assert_eq!(
            committed_paths(&repository),
            vec!["A.md", "B.md", "_attachments/pic.png"]
        );
        assert_eq!(
            repository
                .head()
                .unwrap()
                .peel_to_commit()
                .unwrap()
                .message()
                .unwrap(),
            "Backup: 3 added"
        );

        assert!(snapshot(&repository, &vault).is_none());

        fs::write(vault.join("A.md"), "a, edited").unwrap();
        fs::remove_file(vault.join("B.md")).unwrap();
        fs::write(vault.join("C.excalidraw"), "{}").unwrap();
        let second = snapshot(&repository, &vault).unwrap();
        assert_eq!((second.added, second.modified, second.removed), (1, 1, 1));
        assert_eq!(
            committed_paths(&repository),
            vec!["A.md", "C.excalidraw", "_attachments/pic.png"]
        );

        // Deleted from the backup, never from disk.
        assert!(vault.join("stray.txt").exists());
    }

    #[test]
    fn an_empty_vault_creates_no_commit() {
        let dir = temp_dir("repo-empty");
        let (vault, git_dir) = (dir.join("vault"), dir.join("git"));
        fs::create_dir_all(&vault).unwrap();

        let repository = open_or_init(&git_dir, &vault).unwrap();
        assert!(snapshot(&repository, &vault).is_none());
        assert!(repository.head().is_err());
    }

    #[test]
    fn a_file_version_is_committed_without_touching_the_vault() {
        let dir = temp_dir("repo-file-version");
        let (vault, git_dir) = (dir.join("vault"), dir.join("git"));
        fs::create_dir_all(vault.join("Folder")).unwrap();
        fs::write(vault.join("A.md"), "a").unwrap();
        fs::write(vault.join("Folder/B.md"), "outside").unwrap();

        let repository = open_or_init(&git_dir, &vault).unwrap();
        snapshot(&repository, &vault).unwrap();
        let version = commit_file_version(&repository, "Folder/B.md", b"mine").unwrap();
        assert_eq!(version.unwrap().modified, 1);
        let blob = |path: &str| {
            let tree = repository.head().unwrap().peel_to_tree().unwrap();
            let entry = tree.get_path(Path::new(path)).unwrap();
            repository.find_blob(entry.id()).unwrap().content().to_vec()
        };
        assert_eq!(blob("Folder/B.md"), b"mine");
        assert_eq!(blob("A.md"), b"a");
        assert!(
            commit_file_version(&repository, "Folder/B.md", b"mine")
                .unwrap()
                .is_none()
        );

        // The next version is what's on disk.
        assert_eq!(snapshot(&repository, &vault).unwrap().modified, 1);
        assert_eq!(blob("Folder/B.md"), b"outside");
        assert_eq!(fs::read(vault.join("Folder/B.md")).unwrap(), b"outside");
    }

    #[test]
    fn commit_message_lists_only_nonzero_counts() {
        assert_eq!(commit_message(2, 0, 1), "Backup: 2 added, 1 removed");
        assert_eq!(commit_message(0, 5, 0), "Backup: 5 changed");
    }
}
