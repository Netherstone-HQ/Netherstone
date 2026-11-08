//! The changes an answer proposed: previewing, applying, undoing and
//! discarding them.

use super::chat::ChatError;
use super::runs::open_vault;
use super::sessions::{self, Change, ChangeState};
use super::views::store;
use serde::Serialize;

/// A proposed change to a shard, as the editor previews it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// Vault-relative.
    path: String,
    /// The shard or drawing as it is now, empty for a new one.
    before: String,
    /// The shard or drawing as applying would leave it.
    after: String,
}

/// What applying or undoing left a shard with, for the editor to show.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Made {
    /// Vault-relative.
    path: String,
    /// Its text now, or None when it's gone.
    content: Option<String>,
    /// For a move, where the file was before: vault-relative.
    from: Option<String>,
}

pub(super) fn store_error(error: String) -> String {
    eprintln!("[Netherstone] {error}");
    "Couldn't read the saved chats".to_string()
}

pub(super) fn error_text(error: ChatError) -> String {
    match error {
        ChatError::TurnedOff => "The assistant is off".to_string(),
        ChatError::VaultClosed => "AI is off for this vault".to_string(),
        _ => "Couldn't read the saved chats".to_string(),
    }
}

/// The change `id` in a pending or applied state as `wanted`, with the vault
/// of its chat, while the assistant is on and may use it.
fn change_and_vault(
    store: &sessions::Store,
    id: &str,
    wanted: ChangeState,
) -> Result<(Change, crate::tools::Vault), String> {
    let change = store
        .change(id)
        .map_err(store_error)?
        .filter(|change| change.state == wanted)
        .ok_or_else(|| "That change isn't there anymore".to_string())?;
    let info = store
        .info(&change.chat)
        .map_err(store_error)?
        .ok_or_else(|| "That chat was deleted".to_string())?;
    let vault = open_vault(std::path::Path::new(&info.vault)).map_err(error_text)?;
    Ok((change, vault))
}

/// Runs `work` on the saved chats, off the async threads.
pub(super) async fn with_store<T: Send + 'static>(
    work: impl FnOnce(&sessions::Store) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let store = store().map_err(error_text)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = store
            .lock()
            .map_err(|_| "Saved chats are locked".to_string())?;
        work(&store)
    })
    .await
    .map_err(|_| "Couldn't read the saved chats".to_string())?
}

fn target_of(change: &Change) -> crate::tools::proposals::Target {
    crate::tools::proposals::Target {
        kind: change.kind,
        path: change.path.clone(),
    }
}

/// The text a pending change would leave its shard or drawing with, and
/// the text it has now: none for a new one. A move has none to show.
pub async fn preview(id: String) -> Result<Preview, String> {
    with_store(move |store| {
        let (change, vault) = change_and_vault(store, &id, ChangeState::Pending)?;
        let target = target_of(&change);
        use crate::tools::proposals::Kind;
        let before = match change.kind {
            Kind::NewShard | Kind::NewDrawing => None,
            Kind::Shard | Kind::Drawing => Some(
                crate::tools::proposals::current(&vault, &target)
                    .ok_or_else(|| format!("There's nothing at '{}'", change.path))?,
            ),
            Kind::Move => return Err("A move has no text to show".to_string()),
        };
        let after = crate::tools::proposals::replay(&vault, before.clone(), &change.ops)
            .map_err(|error| error.0)?;
        Ok(Preview {
            path: change.path,
            before: before.unwrap_or_default(),
            after,
        })
    })
    .await
}

/// History's line for a change: what the model said it did, and the model.
fn history_summary(lines: &[String], model: Option<&str>) -> Option<String> {
    let said = lines.join("; ");
    match (said.is_empty(), model) {
        (true, model) => model.map(str::to_string),
        (false, Some(model)) => Some(format!("{said} ({model})")),
        (false, None) => Some(said),
    }
}

const CALLER: &str = "Assistant";

fn caller() -> crate::tools::Caller {
    crate::tools::Caller {
        app: CALLER.to_string(),
    }
}

/// What `files` left at `path`, the change's own file, and for a move
/// the file it left.
fn made(
    kind: crate::tools::proposals::Kind,
    files: &[crate::tools::proposals::FileChange],
    path: &str,
) -> Made {
    let from = match kind {
        crate::tools::proposals::Kind::Move => files
            .iter()
            .find(|file| file.after.is_none() && file.path != path)
            .map(|file| file.path.clone()),
        _ => None,
    };
    Made {
        path: path.to_string(),
        content: files
            .iter()
            .find(|file| file.path == path)
            .and_then(|file| file.after.clone()),
        from,
    }
}

/// Makes a pending change. `expected` is the shard's text as the editor
/// shows it, when it's open.
pub async fn apply(id: String, expected: Option<String>) -> Result<Made, String> {
    with_store(move |store| {
        let (change, vault) = change_and_vault(store, &id, ChangeState::Pending)?;
        let summary = history_summary(
            &crate::tools::proposals::summaries(&change.ops),
            change.model.as_deref(),
        );
        let files = crate::tools::proposals::apply(
            &vault,
            &caller(),
            summary.as_deref(),
            &target_of(&change),
            &change.ops,
            expected.as_deref(),
        )
        .map_err(|error| error.0)?;
        // A new file goes where it was made; a move, where it went.
        let path = match change.kind {
            crate::tools::proposals::Kind::Shard | crate::tools::proposals::Kind::Drawing => {
                change.path.clone()
            }
            _ => files
                .iter()
                .find(|file| file.before.is_none())
                .map_or(change.path.clone(), |file| file.path.clone()),
        };
        store
            .set_change_state(&id, ChangeState::Applied, &files, &path)
            .map_err(store_error)?;
        Ok(made(change.kind, &files, &path))
    })
    .await
}

/// Takes back an applied change, while its files are as it left them. It
/// can then be applied again.
pub async fn undo(id: String) -> Result<Made, String> {
    with_store(move |store| {
        let (change, vault) = change_and_vault(store, &id, ChangeState::Applied)?;
        let summary = history_summary(&["Undid a change".to_string()], change.model.as_deref());
        let files =
            crate::tools::proposals::undo(&vault, &caller(), summary.as_deref(), &change.applied)
                .map_err(|error| error.0)?;
        // Pending again, where it was first proposed.
        let path = match change.kind {
            crate::tools::proposals::Kind::Move => change
                .applied
                .iter()
                .find(|file| file.after.is_none())
                .map_or(change.path.clone(), |file| file.path.clone()),
            _ => change.path.clone(),
        };
        store
            .set_change_state(&id, ChangeState::Pending, &[], &path)
            .map_err(store_error)?;
        Ok(made(change.kind, &files, &path))
    })
    .await
}

/// Drops a pending change, writing nothing.
pub async fn discard(id: String) -> Result<(), String> {
    with_store(move |store| {
        let change = store
            .change(&id)
            .map_err(store_error)?
            .filter(|change| change.state == ChangeState::Pending)
            .ok_or_else(|| "That change isn't there anymore".to_string())?;
        store
            .set_change_state(&id, ChangeState::Discarded, &[], &change.path)
            .map_err(store_error)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tools::proposals::{FileChange, Kind};

    fn file(path: &str, before: Option<&str>, after: Option<&str>) -> FileChange {
        FileChange {
            path: path.to_string(),
            before: before.map(str::to_string),
            after: after.map(str::to_string),
        }
    }

    #[test]
    fn a_move_says_where_the_file_was() {
        let applied = [
            file("Trip.md", Some("# Trip"), None),
            file("Archive/Trip.md", None, Some("# Trip")),
        ];
        let moved = made(Kind::Move, &applied, "Archive/Trip.md");
        assert_eq!(moved.from.as_deref(), Some("Trip.md"));
        assert_eq!(moved.content.as_deref(), Some("# Trip"));

        // Undone, it goes back.
        let undone = [
            file("Trip.md", None, Some("# Trip")),
            file("Archive/Trip.md", Some("# Trip"), None),
        ];
        let back = made(Kind::Move, &undone, "Trip.md");
        assert_eq!(back.from.as_deref(), Some("Archive/Trip.md"));
        assert_eq!(back.content.as_deref(), Some("# Trip"));
    }

    #[test]
    fn an_undone_new_shard_is_gone() {
        let undone = [file("Plans/Lisbon.md", Some("# Lisbon"), None)];
        let gone = made(Kind::NewShard, &undone, "Plans/Lisbon.md");
        assert_eq!(gone.content, None);
        assert_eq!(gone.from, None);
    }
}
