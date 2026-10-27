//! How the tools change a vault: around every change, History saves the
//! files as they were and then as the change left them, noted with the app
//! that made it, so any change can be undone from History.

use super::{Caller, ToolResult, Vault};
use std::path::{Path, PathBuf};

/// Runs `change`, which may touch the files at `touched` and returns what
/// it made along with any files it created or moved things to. Saves the
/// versions around it, then indexes what it changed so the next search
/// finds it.
pub(super) fn change<R>(
    vault: &Vault,
    caller: &Caller,
    summary: Option<&str>,
    touched: &[PathBuf],
    change: impl FnOnce() -> ToolResult<(R, Vec<PathBuf>)>,
) -> ToolResult<R> {
    // Held across the change, so no other version lands in between.
    let _history = crate::locks::history(&vault.sync_root)?;
    let before: Vec<(PathBuf, Option<Vec<u8>>)> =
        touched.iter().map(|path| (path.clone(), std::fs::read(path).ok())).collect();

    let (made, created) = change()?;

    let mut files = before;
    for path in created {
        if !files.iter().any(|(known, _)| *known == path) {
            files.push((path, None));
        }
    }
    let changes: Vec<crate::sync::AppChange> = files
        .iter()
        .filter_map(|(path, before)| {
            let after = std::fs::read(path).ok();
            (after != *before).then(|| crate::sync::AppChange {
                path: vault.relative(path),
                before: before.clone(),
                after,
            })
        })
        .collect();
    if changes.is_empty() {
        return Ok(made);
    }

    let summary = summary.map(str::trim).filter(|summary| !summary.is_empty());
    crate::sync::save_app_change(&vault.sync_root, &vault.root, &changes, &caller.app, summary)?;
    for (path, _) in &files {
        reindex(vault, path);
    }
    Ok(made)
}

/// Brings the index up to date with the shard at `path`, or forgets it once
/// it's gone. A failure only leaves the index to catch up on the next call
/// that reads it, or when the app opens the vault.
pub(super) fn reindex(vault: &Vault, path: &Path) {
    if !crate::vault::is_markdown_path(path) {
        return;
    }
    let result = vault.index_caught_up().and_then(|(conn, now)| {
        if now {
            // Bringing the index up to date just now took this change in.
            Ok(())
        } else if path.is_file() {
            Ok(crate::db::indexer::index_file(&conn, &vault.root, path)?)
        } else {
            crate::db::indexer::forget_path(&conn, &vault.root, path).map(|_| ()).map_err(Into::into)
        }
    });
    if let Err(error) = result {
        eprintln!("[Netherstone] Couldn't index {}: {}", path.display(), error);
    }
}

/// Reads a shard as text.
pub(super) fn read_text(path: &Path) -> ToolResult<String> {
    std::fs::read_to_string(path)
        .map_err(|e| format!("Couldn't read {}: {}", path.display(), e).into())
}

/// Reads the shard at `path`, changes it with `edit` and writes it back,
/// all under one lock, so no save lands in between and is lost.
pub(super) fn edit_shard(
    vault: &Vault,
    path: &Path,
    edit: impl FnOnce(String) -> ToolResult<String>,
) -> ToolResult<()> {
    let writes = crate::locks::vault_writes()?;
    let content = read_text(path)?;
    let edited = edit(content)?;
    Ok(crate::write_shard(&writes, &vault.root, &path.to_string_lossy(), &edited)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::history::{VersionKind, list_versions, read_version};

    #[test]
    fn a_change_keeps_the_version_before_and_notes_the_app() {
        let vault = super::super::tests::vault("tools-change");
        let shard = vault.root.join("Plan.md");
        std::fs::write(&shard, "Typed by hand").unwrap();
        let caller = Caller { app: "Goose".into() };

        change(&vault, &caller, Some("Added a line"), &[shard.clone()], || {
            std::fs::write(&shard, "Typed by hand\n\nAdded").unwrap();
            Ok(((), Vec::new()))
        })
        .unwrap();

        let history = list_versions(&vault.sync_root, &vault.root, &shard).unwrap();
        let now = history.current.unwrap();
        assert_eq!(now.kind, VersionKind::ChangedByApp);
        assert_eq!(now.changed_by.as_deref(), Some("Goose"));
        assert_eq!(now.summary.as_deref(), Some("Added a line"));
        assert_eq!(
            read_version(&vault.sync_root, &vault.root, &history.versions[0].blob).unwrap(),
            "Typed by hand"
        );

        // Nothing changed, nothing saved.
        change(&vault, &caller, None, &[shard.clone()], || Ok(((), Vec::new()))).unwrap();
        let again = list_versions(&vault.sync_root, &vault.root, &shard).unwrap();
        assert_eq!(again.versions.len(), history.versions.len());
    }
}
