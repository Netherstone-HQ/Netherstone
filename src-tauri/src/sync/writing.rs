//! The words written in each shard each day, read from the vault's local
//! history, so the Overview calendar counts other devices and changes made
//! outside the app too.

use super::{history, repo};
use git2::{Commit, Delta, DiffFindOptions, Oid, Repository};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq)]
pub struct WrittenDay {
    /// The local date, as `YYYY-MM-DD`.
    pub day: String,
    /// Vault-relative, with `/` separators.
    pub path: String,
    /// Words added that day, never below zero.
    pub words: i64,
}

#[derive(Debug)]
pub struct WritingHistory {
    /// The day the history began, or the first day asked for when it began
    /// earlier. Writing that day before the first version isn't in it.
    pub began_on: String,
    /// Oldest first.
    pub days: Vec<WrittenDay>,
    /// Every shard path seen changing, lowercased, deleted ones included.
    pub seen_paths: HashSet<String>,
}

/// A shard one commit changed, compared with the commit before it.
#[derive(Debug)]
struct ShardChange {
    path: String,
    renamed_from: Option<String>,
    before: Option<Oid>,
    after: Option<Oid>,
}

/// What each commit changed and each version's word count. Neither changes
/// once written, so the page only works them out once.
static CHANGES: Mutex<Option<HashMap<Oid, Arc<Vec<ShardChange>>>>> = Mutex::new(None);
static WORDS: Mutex<Option<HashMap<Oid, i64>>> = Mutex::new(None);
const MAX_CACHED: usize = 50_000;

fn cached<T: Clone>(cache: &Mutex<Option<HashMap<Oid, T>>>, id: Oid) -> Option<T> {
    cache.lock().ok()?.as_ref()?.get(&id).cloned()
}

fn remember<T>(cache: &Mutex<Option<HashMap<Oid, T>>>, id: Oid, value: T) {
    if let Ok(mut cache) = cache.lock() {
        let cache = cache.get_or_insert_with(HashMap::new);
        if cache.len() >= MAX_CACHED {
            cache.clear();
        }
        cache.insert(id, value);
    }
}

fn git_error(context: &str, e: git2::Error) -> String {
    format!("{}: {}", context, e.message())
}

/// The local date of a commit made at `seconds`.
fn local_day(seconds: i64) -> String {
    chrono::DateTime::from_timestamp(seconds, 0)
        .map(|time| {
            time.with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_default()
}

fn is_shard(path: Option<&Path>) -> Option<String> {
    let path = path?;
    crate::vault::is_markdown_path(path)
        .then(|| path.to_str().map(|path| path.replace('\\', "/")))
        .flatten()
}

/// The shards `commit` changed compared with `parent`.
fn commit_changes(
    repository: &Repository,
    commit: &Commit,
    parent: &Commit,
) -> Result<Arc<Vec<ShardChange>>, String> {
    if let Some(changes) = cached(&CHANGES, commit.id()) {
        return Ok(changes);
    }

    // A sync that joined two unrelated histories, such as a vault with its
    // own history first linked to GitHub, brings in a whole vault at once:
    // that's not writing.
    let joins_unrelated = commit.parent_count() > 1
        && commit
            .parent_id(1)
            .is_ok_and(|other| repository.merge_base(parent.id(), other).is_err());

    let mut changes = Vec::new();
    if !joins_unrelated {
        let read = |e| git_error("Failed to read history", e);
        let (old, new) = (parent.tree().map_err(read)?, commit.tree().map_err(read)?);
        let mut diff = repository
            .diff_tree_to_tree(Some(&old), Some(&new), None)
            .map_err(read)?;
        diff.find_similar(Some(DiffFindOptions::new().renames(true)))
            .map_err(read)?;
        for delta in diff.deltas() {
            let old_path = is_shard(delta.old_file().path());
            let new_path = is_shard(delta.new_file().path());
            let (old_id, new_id) = (delta.old_file().id(), delta.new_file().id());
            let change = match delta.status() {
                Delta::Added => new_path.map(|path| ShardChange {
                    path,
                    renamed_from: None,
                    before: None,
                    after: Some(new_id),
                }),
                Delta::Deleted => old_path.map(|path| ShardChange {
                    path,
                    renamed_from: None,
                    before: Some(old_id),
                    after: None,
                }),
                Delta::Modified | Delta::Renamed | Delta::Typechange => {
                    new_path.map(|path| ShardChange {
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
    }

    let changes = Arc::new(changes);
    remember(&CHANGES, commit.id(), changes.clone());
    Ok(changes)
}

fn word_count(repository: &Repository, id: Oid) -> i64 {
    if let Some(words) = cached(&WORDS, id) {
        return words;
    }
    let words = repository
        .find_blob(id)
        .map(|blob| {
            crate::db::parser::parse_markdown(&String::from_utf8_lossy(blob.content())).word_count
                as i64
        })
        .unwrap_or(0);
    remember(&WORDS, id, words);
    words
}

/// The words added to each shard each day from `since` (`YYYY-MM-DD`) on,
/// like the editor's own count: the words a shard ended the day with less
/// the words it started with. `None` when the vault has no history yet.
///
/// Follows the first parent only, as the history panel does: changes from
/// other devices count on the day a sync brought them in, or on the day they
/// were made when this device's history moved straight to theirs.
pub fn writing_history(
    sync_root: &Path,
    vault_path: &Path,
    since: &str,
) -> Result<Option<WritingHistory>, String> {
    let Some(repository) = history::open_existing(sync_root, vault_path)? else {
        return Ok(None);
    };
    let Some(head) = repo::head_commit(&repository)? else {
        return Ok(None);
    };

    // By day and the name the shard has now: the version before the day's
    // first change, and after its last.
    let mut spans: HashMap<(String, String), (Option<Oid>, Option<Oid>)> = HashMap::new();
    // Older names of renamed shards, to the name they have now.
    let mut names: HashMap<String, String> = HashMap::new();
    let mut seen_paths = HashSet::new();
    let mut began_on = None;
    let mut commit = head;
    loop {
        let day = local_day(commit.time().seconds());
        if day.as_str() < since {
            break;
        }
        let Ok(parent) = commit.parent(0) else {
            began_on = Some(day);
            break;
        };
        // Newest first: the first change seen sets where the day ended, the
        // last where it started.
        for change in commit_changes(&repository, &commit, &parent)?.iter() {
            let current = names
                .get(&change.path)
                .cloned()
                .unwrap_or_else(|| change.path.clone());
            seen_paths.insert(change.path.to_lowercase());
            if let Some(old) = &change.renamed_from {
                seen_paths.insert(old.to_lowercase());
                names.insert(old.clone(), current.clone());
            }
            spans
                .entry((day.clone(), current))
                .or_insert((None, change.after))
                .0 = change.before;
        }
        commit = parent;
    }

    let mut days: Vec<WrittenDay> = spans
        .into_iter()
        // Deleted by the end of the day.
        .filter_map(|((day, path), (before, after))| {
            let after = word_count(&repository, after?);
            let before = before.map_or(0, |id| word_count(&repository, id));
            Some(WrittenDay {
                day,
                path,
                words: (after - before).max(0),
            })
        })
        .collect();
    days.sort_by(|a, b| (&a.day, &a.path).cmp(&(&b.day, &b.path)));

    Ok(Some(WritingHistory {
        began_on: began_on.unwrap_or_else(|| since.to_string()),
        days,
        seen_paths,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use std::fs;

    fn save(sync_root: &Path, vault: &Path, path: &str, text: &str) {
        fs::write(vault.join(path), text).unwrap();
        crate::sync::snapshot_vault(sync_root, vault).unwrap();
    }

    #[test]
    fn counts_words_added_each_day_from_the_history() {
        let dir = temp_dir("writing-history");
        let (vault, sync_root) = (dir.join("vault"), dir.join("sync"));
        fs::create_dir_all(&vault).unwrap();
        // The vault as it was when its history began: not counted as written.
        save(&sync_root, &vault, "Old.md", "one two three");
        save(&sync_root, &vault, "Old.md", "one two three four");
        save(&sync_root, &vault, "Old.md", "one two three four five six");
        save(&sync_root, &vault, "New.md", "a b");
        fs::rename(vault.join("New.md"), vault.join("Renamed.md")).unwrap();
        save(&sync_root, &vault, "Renamed.md", "a b c");
        save(&sync_root, &vault, "Gone.md", "x y");
        fs::remove_file(vault.join("Gone.md")).unwrap();
        crate::sync::snapshot_vault(&sync_root, &vault).unwrap();

        let today = local_day(chrono::Utc::now().timestamp());
        let history = writing_history(&sync_root, &vault, "2000-01-01")
            .unwrap()
            .unwrap();
        assert_eq!(history.began_on, today);
        let days: Vec<_> = history
            .days
            .iter()
            .map(|d| (d.path.as_str(), d.words))
            .collect();
        // Renamed under its new name; Gone was deleted the same day.
        assert_eq!(days, [("Old.md", 3), ("Renamed.md", 3)]);
        assert!(history.seen_paths.contains("gone.md"));
        assert!(history.seen_paths.contains("new.md"));

        // Asked from a later day: nothing yet, all of it counted.
        let later = writing_history(&sync_root, &vault, "2999-01-01")
            .unwrap()
            .unwrap();
        assert!(later.days.is_empty());
        assert_eq!(later.began_on, "2999-01-01");
    }

    #[test]
    fn a_vault_without_history_has_none() {
        let dir = temp_dir("writing-none");
        let vault = dir.join("vault");
        fs::create_dir_all(&vault).unwrap();
        assert!(
            writing_history(&dir.join("sync"), &vault, "2000-01-01")
                .unwrap()
                .is_none()
        );
    }
}
