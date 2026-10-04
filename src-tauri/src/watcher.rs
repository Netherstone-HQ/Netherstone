use notify_debouncer_mini::{
    new_debouncer, notify::RecursiveMode, DebounceEventResult, DebouncedEvent,
};
use serde::Serialize;
use std::{collections::HashSet, sync::Mutex, time::Duration};
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

// ── Public API ────────────────────────────────────────────────────────────────

/// Starts a debounced watcher on `vault_path`.
///
/// Events are debounced for 500ms to avoid flooding the frontend with events
/// during bulk file operations. Only events involving `.md` shards or
/// `.excalidraw` drawings trigger a `vault:changed` emission with the changed
/// paths — directory events and other files are silently ignored.
pub fn watch_vault(app: &AppHandle, vault_path: &str) -> Result<(), String> {
    let app_clone = app.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: DebounceEventResult| {
            let Ok(events) = result else { return };

            let changed_paths = events
                .iter()
                .filter_map(|event: &DebouncedEvent| {
                    crate::vault::is_vault_document_path(&event.path)
                        .then(|| event.path.to_string_lossy().replace('\\', "/"))
                })
                .collect::<HashSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();

            if !changed_paths.is_empty() {
                let payload = VaultChangedPayload {
                    paths: changed_paths,
                };
                let _ = app_clone.emit("vault:changed", payload);
            }
        },
    )
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(std::path::Path::new(vault_path), RecursiveMode::Recursive)
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
