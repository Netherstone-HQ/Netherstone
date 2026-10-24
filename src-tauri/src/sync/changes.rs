//! The changed-paths index: for each version, the files it changed compared
//! with the version before it, so reading a file's history only looks at the
//! versions that touched it instead of opening every version's tree.
//!
//! Versions never change once saved, so neither do their entries. The index
//! is a cache in the repository's own folder (`changed-paths`, one JSON line
//! per version), filled in as versions are first read. Lines are only ever
//! appended; one that can't be read (a write cut short) is worked out again.

use git2::{Commit, Delta, DiffFindOptions, Oid, Repository};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const INDEX_FILE: &str = "changed-paths";

/// One file a version changed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathChange {
    /// Vault-relative, with `/` separators: the path after the change, or the
    /// path that was deleted.
    pub path: String,
    /// The path it had before, when the change renamed or moved it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub renamed_from: Option<String>,
    /// Its blob before and after; `None` when it didn't exist.
    #[serde(default, with = "oid_option")]
    pub before: Option<Oid>,
    #[serde(default, with = "oid_option")]
    pub after: Option<Oid>,
}

/// What one version changed, with what's needed to walk the history without
/// opening it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VersionChanges {
    #[serde(with = "oid")]
    pub id: Oid,
    /// The version before it (the first parent), `None` for the first one.
    #[serde(default, with = "oid_option")]
    pub parent: Option<Oid>,
    pub time: i64,
    /// A sync's merge of this device's versions with another device's.
    #[serde(default)]
    pub merge: bool,
    /// A merge that joined two histories with nothing in common, such as a
    /// vault with its own history first linked to an existing backup.
    #[serde(default)]
    pub joins_unrelated: bool,
    /// The device it was saved on, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    /// For a merge, the device whose versions it brought in, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub merged_from: Option<String>,
    /// The commit message's lines after the first: the version's notes.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub body: String,
    /// Compared with `parent`.
    pub changes: Vec<PathChange>,
}

mod oid {
    use git2::Oid;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(id: &Oid, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&id.to_string())
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Oid, D::Error> {
        let text = String::deserialize(d)?;
        Oid::from_str(&text).map_err(serde::de::Error::custom)
    }
}

mod oid_option {
    use git2::Oid;
    use serde::{Deserialize, Deserializer, Serializer};

    pub fn serialize<S: Serializer>(id: &Option<Oid>, s: S) -> Result<S::Ok, S::Error> {
        match id {
            Some(id) => s.serialize_some(&id.to_string()),
            None => s.serialize_none(),
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Oid>, D::Error> {
        Option::<String>::deserialize(d)?
            .map(|text| Oid::from_str(&text).map_err(serde::de::Error::custom))
            .transpose()
    }
}

fn git_error(context: &str, e: git2::Error) -> String {
    format!("{}: {}", context, e.message())
}

/// Each repository's index, by its folder, as read from its file.
struct Loaded {
    entries: HashMap<Oid, Arc<VersionChanges>>,
    /// How much of the file has been read.
    read_up_to: u64,
}

static INDEXES: Mutex<Option<HashMap<PathBuf, Loaded>>> = Mutex::new(None);

fn index_path(repository: &Repository) -> PathBuf {
    repository.path().join(INDEX_FILE)
}

/// Reads what was added to the file since it was last read, by this process
/// or another one.
fn catch_up(path: &Path, loaded: &mut Loaded) {
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    if (bytes.len() as u64) < loaded.read_up_to {
        // Replaced since: read it all again.
        loaded.entries.clear();
        loaded.read_up_to = 0;
    }
    let new = &bytes[loaded.read_up_to as usize..];
    // Only whole lines: the last one may still be being written.
    let Some(end) = new.iter().rposition(|&b| b == b'\n') else {
        return;
    };
    for line in new[..end].split(|&b| b == b'\n') {
        if let Ok(entry) = serde_json::from_slice::<VersionChanges>(line) {
            loaded.entries.insert(entry.id, Arc::new(entry));
        }
    }
    loaded.read_up_to += end as u64 + 1;
}

fn append(path: &Path, entries: &[Arc<VersionChanges>]) {
    let mut text = String::new();
    for entry in entries {
        if let Ok(line) = serde_json::to_string(entry.as_ref()) {
            text.push_str(&line);
            text.push('\n');
        }
    }
    // A cache: when it can't be written, it's worked out again next time.
    let written = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| file.write_all(text.as_bytes()));
    if let Err(e) = written {
        eprintln!("[Netherstone] Couldn't update {}: {}", path.display(), e);
    }
}

/// Reads entries from the index, working out the ones it doesn't have yet
/// and adding them to it when done.
struct Reader<'r> {
    repository: &'r Repository,
    path: PathBuf,
    known: HashMap<Oid, Arc<VersionChanges>>,
    added: Vec<Arc<VersionChanges>>,
}

impl<'r> Reader<'r> {
    fn new(repository: &'r Repository) -> Self {
        let path = index_path(repository);
        let mut indexes = INDEXES.lock().unwrap_or_else(|e| e.into_inner());
        let loaded = indexes
            .get_or_insert_with(HashMap::new)
            .entry(repository.path().to_path_buf())
            .or_insert_with(|| Loaded {
                entries: HashMap::new(),
                read_up_to: 0,
            });
        catch_up(&path, loaded);
        Reader {
            repository,
            known: loaded.entries.clone(),
            path,
            added: Vec::new(),
        }
    }

    fn get(&mut self, id: Oid) -> Result<Arc<VersionChanges>, String> {
        if let Some(entry) = self.known.get(&id) {
            return Ok(entry.clone());
        }
        let commit = self
            .repository
            .find_commit(id)
            .map_err(|e| git_error("Failed to read history", e))?;
        let entry = Arc::new(changes_of(self.repository, &commit)?);
        self.known.insert(id, entry.clone());
        self.added.push(entry.clone());
        Ok(entry)
    }

    fn finish(mut self) {
        if self.added.is_empty() {
            return;
        }
        let mut indexes = INDEXES.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(loaded) = indexes
            .get_or_insert_with(HashMap::new)
            .get_mut(self.repository.path())
        {
            // Another listing may have added them meanwhile.
            catch_up(&self.path, loaded);
            self.added
                .retain(|entry| !loaded.entries.contains_key(&entry.id));
            append(&self.path, &self.added);
            for entry in &self.added {
                loaded.entries.insert(entry.id, entry.clone());
            }
            // Ours is read already.
            loaded.read_up_to = std::fs::metadata(&self.path)
                .map(|m| m.len())
                .unwrap_or(loaded.read_up_to);
        }
    }
}

/// The versions from `head` back to the first one, following first parents,
/// newest first, each with what it changed, stopping at the first one `keep`
/// turns down. Versions not in the index yet are worked out and added to it.
pub fn first_parent_line(
    repository: &Repository,
    head: Oid,
    keep: impl Fn(&VersionChanges) -> bool,
) -> Result<Vec<Arc<VersionChanges>>, String> {
    let mut reader = Reader::new(repository);
    let mut line = Vec::new();
    let mut next = Some(head);
    while let Some(id) = next {
        let entry = reader.get(id)?;
        if !keep(&entry) {
            break;
        }
        next = entry.parent;
        line.push(entry);
    }
    reader.finish();
    Ok(line)
}

/// Every version reachable from `heads`, other devices' included, each with
/// what it changed compared with its first parent.
pub fn every_version(
    repository: &Repository,
    heads: &[Oid],
) -> Result<Vec<Arc<VersionChanges>>, String> {
    let read = |e| git_error("Failed to read history", e);
    let mut walk = repository.revwalk().map_err(read)?;
    for head in heads {
        walk.push(*head).map_err(read)?;
    }
    let mut reader = Reader::new(repository);
    let versions = walk
        .map(|id| reader.get(id.map_err(read)?))
        .collect::<Result<Vec<_>, String>>()?;
    reader.finish();
    Ok(versions)
}

/// What `commit` changed compared with its first parent.
fn changes_of(repository: &Repository, commit: &Commit) -> Result<VersionChanges, String> {
    let read = |e| git_error("Failed to read history", e);
    let parent = commit.parent(0).ok();
    let joins_unrelated = match (&parent, commit.parent_id(1)) {
        (Some(parent), Ok(other)) => repository.merge_base(parent.id(), other).is_err(),
        _ => false,
    };

    let old = parent
        .as_ref()
        .map(Commit::tree)
        .transpose()
        .map_err(read)?;
    let new = commit.tree().map_err(read)?;
    let mut diff = repository
        .diff_tree_to_tree(old.as_ref(), Some(&new), None)
        .map_err(read)?;
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))
        .map_err(read)?;

    let path_of = |path: Option<&Path>| path.and_then(Path::to_str).map(|p| p.replace('\\', "/"));
    let mut changes = Vec::new();
    for delta in diff.deltas() {
        let (old_path, new_path) = (
            path_of(delta.old_file().path()),
            path_of(delta.new_file().path()),
        );
        let (old_id, new_id) = (delta.old_file().id(), delta.new_file().id());
        let change = match delta.status() {
            Delta::Added => new_path.map(|path| PathChange {
                path,
                renamed_from: None,
                before: None,
                after: Some(new_id),
            }),
            Delta::Deleted => old_path.map(|path| PathChange {
                path,
                renamed_from: None,
                before: Some(old_id),
                after: None,
            }),
            Delta::Modified | Delta::Renamed | Delta::Typechange => {
                new_path.map(|path| PathChange {
                    renamed_from: old_path.filter(|old| *old != path),
                    path,
                    before: Some(old_id),
                    after: Some(new_id),
                })
            }
            _ => None,
        };
        changes.extend(change);
    }

    let message = commit.message().unwrap_or_default();
    let body = message
        .split_once('\n')
        .map(|(_, body)| body.trim().to_string())
        .unwrap_or_default();
    Ok(VersionChanges {
        id: commit.id(),
        parent: parent.map(|parent| parent.id()),
        time: commit.time().seconds(),
        merge: commit.parent_count() > 1,
        joins_unrelated,
        device: super::repo::device_of(commit),
        merged_from: commit
            .parent(1)
            .ok()
            .and_then(|other| super::repo::device_of(&other)),
        body,
        changes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use crate::sync::{repo, state};
    use std::fs;

    fn save(sync_root: &Path, vault: &Path, path: &str, text: &str) {
        fs::write(vault.join(path), text).unwrap();
        crate::sync::snapshot_vault(sync_root, vault).unwrap();
    }

    fn open(sync_root: &Path, vault: &Path) -> Repository {
        let record = state::find_record(sync_root, vault).unwrap().unwrap();
        repo::open_or_init(&state::git_dir(sync_root, &record.vault_id), vault).unwrap()
    }

    fn forget_loaded() {
        *INDEXES.lock().unwrap() = None;
    }

    #[test]
    fn lists_what_each_version_changed_and_keeps_it() {
        let dir = temp_dir("changes-index");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        save(
            &sync_root,
            &vault,
            "A.md",
            "First line\nSecond line\nThird line\n",
        );
        save(&sync_root, &vault, "B.md", "b");
        fs::rename(vault.join("A.md"), vault.join("C.md")).unwrap();
        save(&sync_root, &vault, "B.md", "b, edited");

        let repository = open(&sync_root, &vault);
        let head = repository.head().unwrap().target().unwrap();
        let line = first_parent_line(&repository, head, |_| true).unwrap();
        let paths: Vec<Vec<(&str, Option<&str>)>> = line
            .iter()
            .map(|entry| {
                entry
                    .changes
                    .iter()
                    .map(|c| (c.path.as_str(), c.renamed_from.as_deref()))
                    .collect()
            })
            .collect();
        assert_eq!(
            paths,
            [
                vec![("B.md", None), ("C.md", Some("A.md"))],
                vec![("B.md", None)],
                vec![("A.md", None)],
            ]
        );
        assert_eq!(line[2].parent, None);
        assert_eq!(line[2].changes[0].before, None);

        // Read back from the file, the same.
        let saved = fs::read_to_string(repository.path().join(INDEX_FILE)).unwrap();
        assert_eq!(saved.lines().count(), 3);
        forget_loaded();
        assert_eq!(
            first_parent_line(&repository, head, |_| true).unwrap(),
            line
        );

        // A newer version adds one line; the rest come from the file.
        save(&sync_root, &vault, "B.md", "b, edited again");
        let head = repository.head().unwrap().target().unwrap();
        assert_eq!(
            first_parent_line(&repository, head, |_| true)
                .unwrap()
                .len(),
            4
        );
        let saved = fs::read_to_string(repository.path().join(INDEX_FILE)).unwrap();
        assert_eq!(saved.lines().count(), 4);
    }

    #[test]
    fn a_line_cut_short_is_worked_out_again() {
        let dir = temp_dir("changes-index-cut");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        save(&sync_root, &vault, "A.md", "one");
        save(&sync_root, &vault, "A.md", "two");

        let repository = open(&sync_root, &vault);
        let head = repository.head().unwrap().target().unwrap();
        let line = first_parent_line(&repository, head, |_| true).unwrap();

        let file = repository.path().join(INDEX_FILE);
        let saved = fs::read_to_string(&file).unwrap();
        let first = saved.lines().next().unwrap();
        fs::write(&file, format!("{}\n{{\"id\":\"cut", first)).unwrap();
        forget_loaded();
        assert_eq!(
            first_parent_line(&repository, head, |_| true).unwrap(),
            line
        );
    }
}
