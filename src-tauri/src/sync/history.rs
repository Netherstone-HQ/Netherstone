//! A file's versions in the vault's local history, for the history panel:
//! listing them, reading one, and restoring one.

use super::{planner, repo, state};
use git2::{Commit, DiffFindOptions, ObjectType, Oid, Repository, Tree};
use serde::Serialize;
use std::collections::HashMap;
use std::fmt;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// What a version's commit says about it, in the commit message's body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Note {
    /// `path` changed outside the app; the commit holds that change.
    OutsideChange { path: String },
    /// `path` was restored to its version from `from` (Unix seconds).
    Restored { path: String, from: i64 },
}

const OUTSIDE_CHANGE: &str = "Changed outside the app: ";
const RESTORED: &str = "Restored ";

impl fmt::Display for Note {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Note::OutsideChange { path } => write!(f, "{}{}", OUTSIDE_CHANGE, path),
            Note::Restored { path, from } => write!(f, "{}{} from {}", RESTORED, path, from),
        }
    }
}

impl Note {
    fn parse(line: &str) -> Option<Note> {
        if let Some(path) = line.strip_prefix(OUTSIDE_CHANGE) {
            return Some(Note::OutsideChange {
                path: path.to_string(),
            });
        }
        let (path, from) = line.strip_prefix(RESTORED)?.rsplit_once(" from ")?;
        Some(Note::Restored {
            path: path.to_string(),
            from: from.parse().ok()?,
        })
    }

    fn path(&self) -> &str {
        match self {
            Note::OutsideChange { path } | Note::Restored { path, .. } => path,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VersionKind {
    Created,
    Edited,
    OutsideChange,
    Restored,
    /// Brought in by a sync, from another device.
    Synced,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    /// The commit that saved it.
    pub id: String,
    /// The file's content, as a blob id.
    pub blob: String,
    pub time: i64,
    pub kind: VersionKind,
    /// For a restored version, when the version it brought back was saved.
    pub restored_from: Option<i64>,
    /// Words (shards) or shapes (drawings) compared with the version before.
    pub added: usize,
    pub removed: usize,
    /// Shapes changed in place; always 0 for shards.
    pub changed: usize,
    /// False when the counts weren't worked out in time (see `SUMMARY_BUDGET`).
    pub counted: bool,
}

fn git_error(context: &str, e: git2::Error) -> String {
    format!("{}: {}", context, e.message())
}

/// The vault's repository, or `None` when it has no history yet. Never
/// creates one: reading history shouldn't write anything.
pub(super) fn open_existing(sync_root: &Path, vault_path: &Path) -> Result<Option<Repository>, String> {
    let Some(record) = state::find_record(sync_root, vault_path)? else {
        return Ok(None);
    };
    let git_dir = state::git_dir(sync_root, &record.vault_id);
    if !git_dir.join("HEAD").exists() {
        return Ok(None);
    }
    repo::open_or_init(&git_dir, vault_path).map(Some)
}

fn blob_at(tree: &Tree, path: &str) -> Option<Oid> {
    tree.get_path(Path::new(path))
        .ok()
        .filter(|entry| entry.kind() == Some(ObjectType::Blob))
        .map(|entry| entry.id())
}

/// The path `path` had in `parent`, when `commit` renamed it.
fn renamed_from(
    repository: &Repository,
    parent: &Tree,
    tree: &Tree,
    path: &str,
) -> Result<Option<String>, String> {
    let mut diff = repository
        .diff_tree_to_tree(Some(parent), Some(tree), None)
        .map_err(|e| git_error("Failed to read history", e))?;
    diff.find_similar(Some(DiffFindOptions::new().renames(true)))
        .map_err(|e| git_error("Failed to read history", e))?;
    Ok(diff.deltas().find_map(|delta| {
        let renamed = delta.status() == git2::Delta::Renamed
            && delta.new_file().path().and_then(Path::to_str) == Some(path);
        renamed
            .then(|| {
                delta
                    .old_file()
                    .path()
                    .and_then(Path::to_str)
                    .map(String::from)
            })
            .flatten()
    }))
}

fn note_for(commit: &Commit, path: &str) -> Option<Note> {
    commit
        .message()
        .unwrap_or_default()
        .lines()
        .filter_map(Note::parse)
        .find(|note| note.path() == path)
}

/// One change to the file found walking back through the history.
struct Change {
    id: Oid,
    time: i64,
    blob: Oid,
    previous: Option<Oid>,
    kind: VersionKind,
    restored_from: Option<i64>,
}

/// The versions of `file_path`, newest first, following renames. The newest
/// is left out when it matches the file on disk: that's the file as it is now.
pub fn list_versions(
    sync_root: &Path,
    vault_path: &Path,
    file_path: &Path,
) -> Result<Vec<FileVersion>, String> {
    // No lock: Git objects never change once written, and the panel shouldn't
    // wait for a sync to finish.
    let Some(repository) = open_existing(sync_root, vault_path)? else {
        return Ok(Vec::new());
    };
    let Some(head) = repo::head_commit(&repository)? else {
        return Ok(Vec::new());
    };

    let mut path = super::vault_relative(vault_path, file_path)?;
    let mut commit = head;
    // A deleted file: its versions end with the last one that had it.
    while blob_at(
        &commit
            .tree()
            .map_err(|e| git_error("Failed to read history", e))?,
        &path,
    )
    .is_none()
    {
        match commit.parent(0) {
            Ok(parent) => commit = parent,
            Err(_) => return Ok(Vec::new()),
        }
    }
    let mut changes = Vec::new();
    loop {
        let tree = commit
            .tree()
            .map_err(|e| git_error("Failed to read history", e))?;
        let Some(blob) = blob_at(&tree, &path) else {
            break;
        };
        // Only the first parent: the device's own line of versions, with
        // changes from other devices arriving in the syncs that merged them.
        let parent = commit.parent(0).ok();
        let parent_tree = parent
            .as_ref()
            .map(Commit::tree)
            .transpose()
            .map_err(|e| git_error("Failed to read history", e))?;
        let mut previous = parent_tree.as_ref().and_then(|t| blob_at(t, &path));
        let mut renamed = None;
        if previous.is_none()
            && let Some(parent_tree) = &parent_tree
        {
            renamed = renamed_from(&repository, parent_tree, &tree, &path)?;
            previous = renamed.as_deref().and_then(|old| blob_at(parent_tree, old));
        }

        if previous != Some(blob) {
            let note = note_for(&commit, &path);
            let kind = match (&note, previous) {
                (_, None) => VersionKind::Created,
                (Some(Note::Restored { .. }), _) => VersionKind::Restored,
                (Some(Note::OutsideChange { .. }), _) => VersionKind::OutsideChange,
                _ if commit.parent_count() > 1 => VersionKind::Synced,
                _ => VersionKind::Edited,
            };
            changes.push(Change {
                id: commit.id(),
                time: commit.time().seconds(),
                blob,
                previous,
                kind,
                restored_from: match note {
                    Some(Note::Restored { from, .. }) => Some(from),
                    _ => None,
                },
            });
        }

        if previous.is_none() {
            break;
        }
        if let Some(old) = renamed {
            path = old;
        }
        match parent {
            Some(parent) => commit = parent,
            None => break,
        }
    }

    let on_disk = Oid::hash_file(ObjectType::Blob, file_path).ok();
    if changes
        .first()
        .is_some_and(|change| Some(change.blob) == on_disk)
    {
        changes.remove(0);
    }

    let is_drawing = crate::vault::is_drawing_path(file_path);
    let deadline = Instant::now() + SUMMARY_BUDGET;
    // Some comparisons are always made, so listing again always gets further.
    let mut worked_out = 0;
    Ok(changes
        .into_iter()
        .map(|change| {
            let summary = change.previous.and_then(|previous| {
                cached_summary(previous, change.blob).or_else(|| {
                    (worked_out < MIN_SUMMARIES || Instant::now() < deadline).then(|| {
                        worked_out += 1;
                        summarize(&repository, previous, change.blob, is_drawing)
                    })
                })
            });
            let (added, removed, changed) = summary.unwrap_or_default();
            FileVersion {
                id: change.id.to_string(),
                blob: change.blob.to_string(),
                time: change.time,
                kind: change.kind,
                restored_from: change.restored_from,
                added,
                removed,
                changed,
                counted: summary.is_some() || change.previous.is_none(),
            }
        })
        .collect())
}

/// How long one listing may spend comparing versions, newest first, so the
/// panel opens at once on a long history. Versions past it come back without
/// counts; counts are cached, so listing again gets further.
const SUMMARY_BUDGET: Duration = Duration::from_millis(400);
const MIN_SUMMARIES: usize = 10;

type Summary = (usize, usize, usize);

/// Comparisons already made, by the blobs compared. Versions never change,
/// so neither do their counts.
static SUMMARIES: Mutex<Option<HashMap<(Oid, Oid), Summary>>> = Mutex::new(None);
const MAX_CACHED_SUMMARIES: usize = 20_000;

fn cached_summary(before: Oid, after: Oid) -> Option<Summary> {
    SUMMARIES
        .lock()
        .ok()
        .and_then(|cache| cache.as_ref()?.get(&(before, after)).copied())
}

fn summarize(repository: &Repository, before: Oid, after: Oid, is_drawing: bool) -> Summary {
    let key = (before, after);
    let read = |id: Oid| {
        repository
            .find_blob(id)
            .map(|blob| String::from_utf8_lossy(blob.content()).into_owned())
            .unwrap_or_default()
    };
    let (before, after) = (read(before), read(after));
    let summary = if is_drawing {
        compare_drawings(&before, &after)
    } else {
        let (added, removed) = compare_words(&before, &after);
        (added, removed, 0)
    };

    if let Ok(mut cache) = SUMMARIES.lock() {
        let cache = cache.get_or_insert_with(HashMap::new);
        if cache.len() >= MAX_CACHED_SUMMARIES {
            cache.clear();
        }
        cache.insert(key, summary);
    }
    summary
}

/// Words added and removed between two versions of a shard, as people read
/// it: Markdown syntax doesn't count.
pub fn compare_words(before: &str, after: &str) -> (usize, usize) {
    let words = |markdown: &str| -> Vec<String> {
        crate::markdown_text::text_blocks(markdown)
            .iter()
            .flat_map(|block| {
                block
                    .text
                    .split_whitespace()
                    .map(String::from)
                    .collect::<Vec<_>>()
            })
            .collect()
    };
    let (before, after) = (words(before), words(after));
    let deadline = Instant::now() + Duration::from_millis(200);
    let ops = similar::capture_diff_slices_deadline(
        similar::Algorithm::Myers,
        &before,
        &after,
        Some(deadline),
    );
    ops.iter().fold((0, 0), |(added, removed), op| match *op {
        similar::DiffOp::Insert { new_len, .. } => (added + new_len, removed),
        similar::DiffOp::Delete { old_len, .. } => (added, removed + old_len),
        similar::DiffOp::Replace {
            old_len, new_len, ..
        } => (added + new_len, removed + old_len),
        similar::DiffOp::Equal { .. } => (added, removed),
    })
}

/// Each shape of a drawing by id, with what makes it look the way it does.
/// Text inside a shape counts as part of that shape.
fn drawing_shapes(json: &str) -> HashMap<String, Vec<i64>> {
    let scene: serde_json::Value = serde_json::from_str(json).unwrap_or_default();
    let mut shapes: HashMap<String, Vec<i64>> = HashMap::new();
    let elements = scene
        .get("elements")
        .and_then(|elements| elements.as_array())
        .into_iter()
        .flatten();
    for element in elements {
        if element.get("isDeleted").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }
        let field = |name: &str| element.get(name).and_then(|v| v.as_str());
        let Some(id) = field("id") else { continue };
        let owner = field("containerId").unwrap_or(id).to_string();
        let version = element.get("version").and_then(|v| v.as_i64()).unwrap_or(0);
        let entry = shapes.entry(owner).or_default();
        if field("containerId").is_some() {
            entry.push(version);
        } else {
            entry.insert(0, version);
        }
    }
    shapes
}

/// Shapes added, removed and changed between two versions of a drawing.
pub fn compare_drawings(before: &str, after: &str) -> Summary {
    let (before, after) = (drawing_shapes(before), drawing_shapes(after));
    let added = after.keys().filter(|id| !before.contains_key(*id)).count();
    let removed = before.keys().filter(|id| !after.contains_key(*id)).count();
    let changed = after
        .iter()
        .filter(|(id, shape)| before.get(*id).is_some_and(|old| old != *shape))
        .count();
    (added, removed, changed)
}

/// The content of a version, by its blob id.
pub fn read_version(sync_root: &Path, vault_path: &Path, blob: &str) -> Result<String, String> {
    let repository = open_existing(sync_root, vault_path)?
        .ok_or_else(|| "This version is no longer available.".to_string())?;
    let id = Oid::from_str(blob).map_err(|e| e.message().to_string())?;
    let blob = repository
        .find_blob(id)
        .map_err(|_| "This version is no longer available.".to_string())?;
    Ok(String::from_utf8_lossy(blob.content()).into_owned())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    /// What the file holds now.
    pub content: String,
    /// The version saved just before restoring, which Undo brings back.
    pub undo: Option<UndoVersion>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoVersion {
    pub blob: String,
    pub time: i64,
}

/// Puts the version `blob` (saved at `version_time`) back in `file_path`.
/// The file as it is now is saved as a version first, so the restore can be
/// undone, then `write` writes the version and that's saved as a version too.
pub fn restore(
    sync_root: &Path,
    vault_path: &Path,
    file_path: &Path,
    blob: &str,
    version_time: i64,
    write: impl FnOnce(&str) -> Result<(), String>,
) -> Result<RestoreResult, String> {
    let _guard = crate::locks::history(sync_root)?;
    let relative = super::vault_relative(vault_path, file_path)?;
    super::snapshot_locked(sync_root, vault_path)?;

    let content = read_version(sync_root, vault_path, blob)?;
    let repository = open_existing(sync_root, vault_path)?
        .ok_or_else(|| "This version is no longer available.".to_string())?;
    let undo = repo::head_commit(&repository)?.and_then(|head| {
        let tree = head.tree().ok()?;
        Some(UndoVersion {
            blob: blob_at(&tree, &relative)?.to_string(),
            time: head.time().seconds(),
        })
    });

    write(&content)?;

    let plan = planner::plan_vault(vault_path)?;
    super::commit_snapshot(
        sync_root,
        vault_path,
        plan,
        Some(Note::Restored {
            path: relative,
            from: version_time,
        }),
    )?;
    Ok(RestoreResult { content, undo })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use std::fs;

    fn setup(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let dir = temp_dir(name);
        let vault = dir.join("vault");
        fs::create_dir_all(&vault).unwrap();
        (vault, dir.join("sync"))
    }

    fn save(sync_root: &Path, vault: &Path, path: &str, text: &str) {
        fs::write(vault.join(path), text).unwrap();
        crate::sync::snapshot_vault(sync_root, vault).unwrap();
    }

    fn kinds(versions: &[FileVersion]) -> Vec<VersionKind> {
        versions.iter().map(|v| v.kind).collect()
    }

    #[test]
    fn notes_round_trip_through_commit_messages() {
        for note in [
            Note::OutsideChange {
                path: "A from B.md".into(),
            },
            Note::Restored {
                path: "Folder/A from B.md".into(),
                from: 1_760_000_000,
            },
        ] {
            assert_eq!(Note::parse(&note.to_string()), Some(note));
        }
        assert_eq!(Note::parse("Backup: 1 changed"), None);
    }

    #[test]
    fn lists_a_files_versions_newest_first_without_the_current_one() {
        let (vault, sync_root) = setup("history-list");
        save(&sync_root, &vault, "Note.md", "One two three");
        save(&sync_root, &vault, "Other.md", "Unrelated");
        save(&sync_root, &vault, "Note.md", "One two three four five");
        save(&sync_root, &vault, "Note.md", "One three four five six");

        let versions = list_versions(&sync_root, &vault, &vault.join("Note.md")).unwrap();
        // The newest matches the file on disk: that's "Now".
        assert_eq!(
            kinds(&versions),
            [VersionKind::Edited, VersionKind::Created]
        );
        assert_eq!((versions[0].added, versions[0].removed), (2, 0));
        assert_eq!(
            read_version(&sync_root, &vault, &versions[1].blob).unwrap(),
            "One two three"
        );

        // Typed since the last version: it shows again.
        fs::write(vault.join("Note.md"), "Unsaved as a version").unwrap();
        let versions = list_versions(&sync_root, &vault, &vault.join("Note.md")).unwrap();
        assert_eq!(versions.len(), 3);
        assert_eq!((versions[0].added, versions[0].removed), (1, 1));
    }

    #[test]
    fn a_file_without_history_has_no_versions() {
        let (vault, sync_root) = setup("history-none");
        fs::write(vault.join("Note.md"), "Text").unwrap();
        assert!(
            list_versions(&sync_root, &vault, &vault.join("Note.md"))
                .unwrap()
                .is_empty()
        );
        assert!(!sync_root.exists() || fs::read_dir(&sync_root).unwrap().next().is_none());
    }

    #[test]
    fn follows_a_rename() {
        let (vault, sync_root) = setup("history-rename");
        save(&sync_root, &vault, "Old.md", "Some text here");
        save(&sync_root, &vault, "Old.md", "Some more text here");
        fs::rename(vault.join("Old.md"), vault.join("New.md")).unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();
        save(&sync_root, &vault, "New.md", "Some more text here, renamed");

        let versions = list_versions(&sync_root, &vault, &vault.join("New.md")).unwrap();
        assert_eq!(
            kinds(&versions),
            [VersionKind::Edited, VersionKind::Created]
        );
    }

    #[test]
    fn restore_saves_the_current_text_first_and_can_be_undone() {
        let (vault, sync_root) = setup("history-restore");
        save(&sync_root, &vault, "Note.md", "First");
        save(&sync_root, &vault, "Note.md", "Second");
        // Not saved as a version yet.
        fs::write(vault.join("Note.md"), "Third").unwrap();

        let file = vault.join("Note.md");
        let versions = list_versions(&sync_root, &vault, &file).unwrap();
        let first = versions.last().unwrap();
        let write = |text: &str| fs::write(&file, text).map_err(|e| e.to_string());
        let result = restore(&sync_root, &vault, &file, &first.blob, first.time, write).unwrap();
        assert_eq!(result.content, "First");
        assert_eq!(fs::read_to_string(&file).unwrap(), "First");

        let versions = list_versions(&sync_root, &vault, &file).unwrap();
        // Third (saved before restoring), Second, First; the restored one is Now.
        assert_eq!(versions.len(), 3);
        let undo = result.undo.unwrap();
        assert_eq!(
            read_version(&sync_root, &vault, &undo.blob).unwrap(),
            "Third"
        );

        restore(&sync_root, &vault, &file, &undo.blob, undo.time, write).unwrap();
        assert_eq!(fs::read_to_string(&file).unwrap(), "Third");
        let versions = list_versions(&sync_root, &vault, &file).unwrap();
        assert_eq!(versions[0].kind, VersionKind::Restored);
        assert_eq!(versions[0].restored_from, Some(first.time));
    }

    #[test]
    fn a_deleted_file_keeps_its_versions_and_can_be_restored() {
        let (vault, sync_root) = setup("history-deleted");
        fs::create_dir_all(vault.join("Folder")).unwrap();
        save(&sync_root, &vault, "Folder/Note.md", "First");
        save(&sync_root, &vault, "Folder/Note.md", "Second");
        fs::remove_dir_all(vault.join("Folder")).unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();

        let file = vault.join("Folder/Note.md");
        let versions = list_versions(&sync_root, &vault, &file).unwrap();
        // Its last version too: nothing on disk is "Now".
        assert_eq!(
            kinds(&versions),
            [VersionKind::Edited, VersionKind::Created]
        );

        let latest = &versions[0];
        let write = |text: &str| {
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(&file, text).map_err(|e| e.to_string())
        };
        let result = restore(&sync_root, &vault, &file, &latest.blob, latest.time, write).unwrap();
        assert!(result.undo.is_none());
        assert_eq!(fs::read_to_string(&file).unwrap(), "Second");
    }

    #[test]
    fn an_outside_change_is_named() {
        let (vault, sync_root) = setup("history-outside");
        save(&sync_root, &vault, "Note.md", "Mine");
        fs::write(vault.join("Note.md"), "Outside").unwrap();
        crate::sync::snapshot_outside_change(
            &sync_root,
            &vault,
            &vault.join("Note.md"),
            "Mine, edited",
        )
        .unwrap();
        fs::write(vault.join("Note.md"), "Typed after").unwrap();

        let versions = list_versions(&sync_root, &vault, &vault.join("Note.md")).unwrap();
        assert_eq!(
            kinds(&versions),
            [
                VersionKind::OutsideChange,
                VersionKind::Edited,
                VersionKind::Created
            ]
        );
    }

    #[test]
    fn counts_words_people_read() {
        assert_eq!(
            compare_words("Hello **world**", "Hello *big* world"),
            (1, 0)
        );
        assert_eq!(compare_words("a b c", "a c d"), (1, 1));
        assert_eq!(compare_words("Same", "Same"), (0, 0));
    }

    #[test]
    fn counts_shapes_with_their_labels() {
        let scene = |elements: &str| format!(r#"{{"elements":[{}]}}"#, elements);
        let before = scene(
            r#"{"id":"a","version":1},{"id":"b","version":1},{"id":"t","version":1,"containerId":"a"}"#,
        );
        let after = scene(
            r#"{"id":"a","version":1},{"id":"t","version":2,"containerId":"a"},{"id":"c","version":1},{"id":"b","version":3,"isDeleted":true}"#,
        );
        // c added, b removed, a changed (its label).
        assert_eq!(compare_drawings(&before, &after), (1, 1, 1));
    }
}
