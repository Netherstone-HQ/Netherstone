use notify_debouncer_mini::{
    DebounceEventResult, DebouncedEvent, new_debouncer, notify::RecursiveMode,
};
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

// ── Types ─────────────────────────────────────────────────────────────────────

type ActiveWatcher =
    notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

#[derive(Debug, Clone, Serialize)]
struct VaultChangedPayload {
    paths: Vec<String>,
}

/// Tauri managed state holding the active vault watcher.
/// Stored in an `Option` so dropping it (by setting to `None`) stops watching.
pub struct WatcherState(pub Mutex<Option<ActiveWatcher>>);

impl WatcherState {
    pub fn new() -> Self {
        Self(Mutex::new(None))
    }
}

/// Remembers the vault's folders so folder events can be told apart.
///
/// Renaming, moving or deleting a folder reports only the folder itself, not
/// the shards inside it, so those events must refresh the vault too. A folder
/// that already existed is also reported whenever a file inside it changes
/// (Windows does this on every save), and those events must not.
struct FolderTracker {
    root: PathBuf,
    folders: HashSet<PathBuf>,
}

impl FolderTracker {
    fn new(root: &Path) -> Self {
        let mut tracker = Self {
            root: root.to_path_buf(),
            folders: HashSet::new(),
        };
        tracker.add_tree(root);
        tracker.folders.remove(root);
        tracker
    }

    /// True when `path` is a folder that appeared or disappeared.
    fn observe(&mut self, path: &Path) -> bool {
        if !self.is_scanned(path) {
            return false;
        }

        if path.is_dir() {
            if self.folders.contains(path) {
                return false;
            }
            self.add_tree(path);
            return true;
        }

        if self.folders.contains(path) {
            self.folders.retain(|folder| !folder.starts_with(path));
            return true;
        }

        false
    }

    fn is_scanned(&self, path: &Path) -> bool {
        let Ok(relative) = path.strip_prefix(&self.root) else {
            return false;
        };
        relative.components().next().is_some()
            && relative
                .components()
                .all(|part| crate::vault::is_scanned_name(&part.as_os_str().to_string_lossy()))
    }

    fn add_tree(&mut self, dir: &Path) {
        self.folders.insert(dir.to_path_buf());
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.filter_map(|entry| entry.ok()) {
            let is_dir = entry.file_type().is_ok_and(|kind| kind.is_dir());
            if is_dir && crate::vault::is_scanned_name(&entry.file_name().to_string_lossy()) {
                self.add_tree(&entry.path());
            }
        }
    }
}

// ── Public API ────────────────────────────────────────────────────────────────

/// Starts a debounced watcher on `vault_path`.
///
/// Events are debounced for 500ms to avoid flooding the frontend with events
/// during bulk file operations. Events involving `.md` shards, `.excalidraw`
/// drawings, or folders that appeared or disappeared trigger a
/// `vault:changed` emission with the changed paths; other files are ignored.
/// If the OS drops events (its buffer overflowed during a large change), an
/// emission with no paths asks the app to rescan everything.
pub fn watch_vault(app: &AppHandle, vault_path: &str) -> Result<(), String> {
    let app_clone = app.clone();
    let mut folders = FolderTracker::new(Path::new(vault_path));

    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: DebounceEventResult| {
            let changed_paths = match result {
                Ok(events) => {
                    let paths = events
                        .iter()
                        .filter(|event: &&DebouncedEvent| {
                            crate::vault::is_vault_document_path(&event.path)
                                || folders.observe(&event.path)
                        })
                        .map(|event| event.path.to_string_lossy().replace('\\', "/"))
                        .collect::<HashSet<_>>();
                    if paths.is_empty() {
                        return;
                    }
                    paths.into_iter().collect::<Vec<_>>()
                }
                Err(error) => {
                    eprintln!("[Netherstone] Vault watcher error, rescanning: {}", error);
                    folders = FolderTracker::new(&folders.root.clone());
                    Vec::new()
                }
            };

            let payload = VaultChangedPayload {
                paths: changed_paths,
            };
            let _ = app_clone.emit("vault:changed", payload);
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(Path::new(vault_path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    // Move the debouncer into managed state. Dropping the previous value here
    // automatically stops any previously active watcher.
    *app.state::<WatcherState>().0.lock().unwrap() = Some(debouncer);

    Ok(())
}

/// Stops the active watcher by dropping the debouncer from managed state.
pub fn unwatch_vault(app: &AppHandle) {
    *app.state::<WatcherState>().0.lock().unwrap() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netherstone-watcher-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn reports_renamed_and_deleted_folders() {
        let vault = temp_vault("rename");
        std::fs::create_dir_all(vault.join("Projects/Old")).unwrap();
        let mut folders = FolderTracker::new(&vault);

        std::fs::rename(vault.join("Projects"), vault.join("Work")).unwrap();
        assert!(folders.observe(&vault.join("Projects")));
        assert!(folders.observe(&vault.join("Work")));
        // The nested folder moved with its parent.
        assert!(!folders.observe(&vault.join("Work/Old")));
        assert!(!folders.observe(&vault.join("Projects/Old")));

        std::fs::remove_dir_all(vault.join("Work")).unwrap();
        assert!(folders.observe(&vault.join("Work")));
        assert!(!folders.observe(&vault.join("Work")));
    }

    #[test]
    fn ignores_existing_folders_and_other_files() {
        let vault = temp_vault("ignore");
        std::fs::create_dir_all(vault.join("Notes")).unwrap();
        std::fs::create_dir_all(vault.join(".git/objects")).unwrap();
        let mut folders = FolderTracker::new(&vault);

        // A save inside the folder reports the folder as modified.
        assert!(!folders.observe(&vault.join("Notes")));
        assert!(!folders.observe(&vault.join("Notes/draft.md.tmp")));
        assert!(!folders.observe(&vault));

        std::fs::create_dir_all(vault.join(".git/refs")).unwrap();
        assert!(!folders.observe(&vault.join(".git/refs")));
        std::fs::remove_dir_all(vault.join(".git")).unwrap();
        assert!(!folders.observe(&vault.join(".git")));
    }

    #[test]
    fn reports_a_folder_moved_into_the_vault() {
        let vault = temp_vault("move-in");
        let mut folders = FolderTracker::new(&vault);

        std::fs::create_dir_all(vault.join("Imported/Inner")).unwrap();
        assert!(folders.observe(&vault.join("Imported")));
        assert!(!folders.observe(&vault.join("Imported/Inner")));
    }
}
