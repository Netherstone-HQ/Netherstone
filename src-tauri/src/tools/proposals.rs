//! The write tools as proposals, for the app's own assistant: a call is
//! checked and kept rather than made, the text it would leave is worked
//! out on demand, and it's made only when the user applies it. Applying
//! runs the calls again on the file as it is then, and saves one version
//! in History; undoing puts back what applying changed.

use super::drawings::{self, DrawingTarget, EditDrawingParams};
use super::edits::{edit_shard, read_text, recorded, reindex};
use super::write::{self, CreateShardParams, EditShardParams, MoveParams};
use super::{Caller, ToolError, ToolResult, Vault};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// The write tools the assistant proposes.
pub const WRITE_TOOLS: [&str; 4] = ["create_shard", "edit_shard", "move", "edit_drawing"];

/// What a change is to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Shard,
    NewShard,
    Drawing,
    NewDrawing,
    Move,
}

impl Kind {
    /// Whether calls of `other` on the same path add to a change of this kind.
    fn takes(self, other: Kind) -> bool {
        matches!(
            (self, other),
            (Kind::Shard | Kind::NewShard, Kind::Shard)
                | (Kind::Drawing | Kind::NewDrawing, Kind::Drawing)
        )
    }
}

/// One proposed call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Op {
    pub name: String,
    pub arguments: Value,
}

/// The file a call changes: what it is and its vault-relative path. For a
/// move, the path is what moves.
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub kind: Kind,
    pub path: String,
}

/// A file as applying or undoing left it, and as it was before.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileChange {
    /// Vault-relative.
    pub path: String,
    pub before: Option<String>,
    pub after: Option<String>,
}

fn params<P: DeserializeOwned>(op: &Op) -> ToolResult<P> {
    serde_json::from_value(op.arguments.clone())
        .map_err(|e| ToolError(format!("Those arguments don't fit {}: {}", op.name, e)))
}

/// The file `op` changes, checked as far as it can be before running it.
pub fn target(vault: &Vault, op: &Op) -> ToolResult<Target> {
    let (kind, path) = match op.name.as_str() {
        "edit_shard" => {
            let params: EditShardParams = params(op)?;
            let path = vault.resolve(&params.path)?;
            if !crate::vault::is_markdown_path(&path) {
                return Err(ToolError(format!(
                    "'{}' isn't a shard (a .md file)",
                    params.path
                )));
            }
            (Kind::Shard, path)
        }
        "create_shard" => {
            let params: CreateShardParams = params(op)?;
            (Kind::NewShard, write::new_shard_path(vault, &params)?)
        }
        "move" => {
            let params: MoveParams = params(op)?;
            write::check_move(vault, &params)?;
            (Kind::Move, vault.resolve(&params.path)?)
        }
        "edit_drawing" => {
            let params: EditDrawingParams = params(op)?;
            match drawings::target(vault, &params)? {
                DrawingTarget::New(path) => (Kind::NewDrawing, path),
                DrawingTarget::Drawing(path) => (Kind::Drawing, path),
                DrawingTarget::Embed(shard, _) => (Kind::Shard, shard),
            }
        }
        name => return Err(ToolError(format!("There's no tool called {}", name))),
    };
    Ok(Target {
        kind,
        path: vault.relative(&path),
    })
}

/// Where a move puts its file or folder: the folder ("" for the top of the
/// vault) and the new name, each when the move gives it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moving {
    pub folder: Option<String>,
    pub name: Option<String>,
}

/// Where the move in `ops` puts its file, if they hold one.
pub fn moving(ops: &[Op]) -> Option<Moving> {
    let op = ops.iter().find(|op| op.name == "move")?;
    let text = |key: &str| {
        op.arguments
            .get(key)
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    Some(Moving {
        folder: text("to_folder"),
        name: text("new_name"),
    })
}

/// Whether a call on `next` goes into a change made so far to `target`.
pub fn adds_to(target: &Target, next: &Target) -> bool {
    target.path == next.path && target.kind.takes(next.kind)
}

/// The file's text now, or None when it isn't there.
pub fn current(vault: &Vault, target: &Target) -> Option<String> {
    match target.kind {
        Kind::Shard | Kind::Drawing => vault
            .resolve(&target.path)
            .ok()
            .and_then(|path| std::fs::read_to_string(path).ok()),
        _ => None,
    }
}

/// The text `ops` leave the file with, starting from `base`: the file as
/// it is, or nothing for a new one.
pub fn replay(vault: &Vault, base: Option<String>, ops: &[Op]) -> ToolResult<String> {
    let mut text = base;
    for op in ops {
        text = Some(match op.name.as_str() {
            "edit_shard" => {
                let params: EditShardParams = params(op)?;
                let markdown = text
                    .ok_or_else(|| ToolError(format!("There's no shard at '{}'", params.path)))?;
                write::edit(markdown, &params)?
            }
            "create_shard" => {
                let params: CreateShardParams = params(op)?;
                params.content
            }
            "edit_drawing" => {
                let params: EditDrawingParams = params(op)?;
                match drawings::target(vault, &params)? {
                    DrawingTarget::Embed(_, relative) => {
                        let markdown = text.ok_or_else(|| {
                            ToolError("There's no shard to show it in".to_string())
                        })?;
                        drawings::embedded(&markdown, &relative, params.heading.as_deref())?
                    }
                    _ => drawings::scene_after(text.as_deref(), &params)?,
                }
            }
            name => {
                return Err(ToolError(format!(
                    "{} can't be shown before it's made",
                    name
                )));
            }
        });
    }
    text.ok_or_else(|| ToolError("Nothing to change".to_string()))
}

/// What the calls' summaries say, one line each, without repeats.
pub fn summaries(ops: &[Op]) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for op in ops {
        if let Some(line) = op
            .arguments
            .get("summary")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|line| !line.is_empty())
            && !lines.iter().any(|known| known == line)
        {
            lines.push(line.to_string());
        }
    }
    lines
}

fn text_of(bytes: &Option<Vec<u8>>) -> Option<String> {
    bytes
        .as_ref()
        .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
}

fn file_changes(changes: Vec<crate::sync::AppChange>) -> Vec<FileChange> {
    changes
        .into_iter()
        .map(|change| FileChange {
            before: text_of(&change.before),
            after: text_of(&change.after),
            path: change.path,
        })
        .collect()
}

/// What applying refuses with when the file isn't the text the app shows.
pub const CHANGED_ON_DISK: &str = "The shard changed on disk";

/// Makes the change `ops` propose to `target`, noted in History by
/// `caller` with `summary`. `expected`, when given, is the text the app
/// shows for the file: if the file holds something else, nothing is made.
pub fn apply(
    vault: &Vault,
    caller: &Caller,
    summary: Option<&str>,
    target: &Target,
    ops: &[Op],
    expected: Option<&str>,
) -> ToolResult<Vec<FileChange>> {
    let changed = |path: &str| {
        let name = Path::new(path)
            .file_stem()
            .map(|stem| stem.to_string_lossy().into_owned())
            .unwrap_or_default();
        move |error: ToolError| {
            ToolError(format!(
                "{} changed since, so this change doesn't fit it anymore ({})",
                name, error.0
            ))
        }
    };
    let changes = match target.kind {
        Kind::Shard => {
            let path = vault.shard(&target.path)?;
            recorded(vault, caller, summary, std::slice::from_ref(&path), || {
                edit_shard(vault, &path, |markdown| {
                    if expected.is_some_and(|expected| expected != markdown) {
                        return Err(ToolError(CHANGED_ON_DISK.to_string()));
                    }
                    replay(vault, Some(markdown), ops).map_err(changed(&target.path))
                })?;
                Ok(((), Vec::new()))
            })?
            .1
        }
        Kind::Drawing => {
            let path = vault.resolve(&target.path)?;
            recorded(vault, caller, summary, std::slice::from_ref(&path), || {
                // Held from the read, so a canvas save can't land in between.
                let writes = crate::locks::vault_writes()?;
                let content =
                    replay(vault, Some(read_text(&path)?), ops).map_err(changed(&target.path))?;
                crate::vault::write_atomically(&writes, &path, content.as_bytes())?;
                Ok(((), Vec::new()))
            })?
            .1
        }
        Kind::NewShard => {
            let wanted = vault.resolve(&target.path)?;
            let content = replay(vault, None, ops)?;
            recorded(vault, caller, summary, &[], || {
                let writes = crate::locks::vault_writes()?;
                let path = crate::import::prepare_new_shard(&vault.root, &wanted)?;
                crate::write_shard(&writes, &vault.root, &path.to_string_lossy(), &content)?;
                Ok(((), vec![path]))
            })?
            .1
        }
        Kind::NewDrawing => {
            let wanted = vault.resolve(&target.path)?;
            let content = replay(vault, None, ops)?;
            recorded(vault, caller, summary, &[], || {
                let writes = crate::locks::vault_writes()?;
                let path = drawings::new_drawing_path(vault, &wanted)?;
                crate::vault::write_atomically(&writes, &path, content.as_bytes())?;
                Ok(((), vec![path]))
            })?
            .1
        }
        Kind::Move => {
            let op = ops
                .first()
                .ok_or_else(|| ToolError("Nothing to move".to_string()))?;
            write::move_recorded(vault, caller, params(op)?, summary)?.1
        }
    };
    Ok(file_changes(changes))
}

/// Puts back the files `applied` changed, as long as each is still as it
/// left it, and notes that in History by `caller` with `summary`. A file
/// it made is taken out again; History keeps it.
pub fn undo(
    vault: &Vault,
    caller: &Caller,
    summary: Option<&str>,
    applied: &[FileChange],
) -> ToolResult<Vec<FileChange>> {
    let _history = crate::locks::history(&vault.sync_root)?;
    let paths: Vec<PathBuf> = applied
        .iter()
        .map(|file| vault.resolve(&file.path))
        .collect::<ToolResult<_>>()?;
    // Held from the check, so nothing lands between it and the writes.
    let writes = crate::locks::vault_writes()?;
    for (file, path) in applied.iter().zip(&paths) {
        let now = std::fs::read(path).ok();
        if now.as_deref() != file.after.as_deref().map(str::as_bytes) {
            let name = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            return Err(ToolError(format!(
                "{} changed since, so the change can't be undone. Its History has the version before.",
                name
            )));
        }
    }

    // Files made come out first, so a move back finds its old name free.
    let mut order: Vec<usize> = (0..applied.len()).collect();
    order.sort_by_key(|&index| applied[index].before.is_some());
    {
        for index in order {
            let (file, path) = (&applied[index], &paths[index]);
            match &file.before {
                Some(before) => {
                    if let Some(folder) = path.parent() {
                        std::fs::create_dir_all(folder).map_err(|e| {
                            format!("Failed to create folder {}: {}", folder.display(), e)
                        })?;
                    }
                    if crate::vault::is_markdown_path(path) {
                        crate::write_shard(&writes, &vault.root, &path.to_string_lossy(), before)?;
                    } else {
                        crate::vault::write_atomically(&writes, path, before.as_bytes())?;
                    }
                }
                None => std::fs::remove_file(path)
                    .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?,
            }
        }
    }
    drop(writes);

    let undone: Vec<crate::sync::AppChange> = applied
        .iter()
        .map(|file| crate::sync::AppChange {
            path: file.path.clone(),
            before: file.after.clone().map(String::into_bytes),
            after: file.before.clone().map(String::into_bytes),
        })
        .collect();
    crate::sync::save_app_change(&vault.sync_root, &vault.root, &undone, &caller.app, summary)?;
    for path in &paths {
        reindex(vault, path);
    }
    Ok(file_changes(undone))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::history::{VersionKind, list_versions};
    use serde_json::json;

    fn op(name: &str, arguments: Value) -> Op {
        Op {
            name: name.to_string(),
            arguments,
        }
    }

    fn caller() -> Caller {
        Caller {
            app: "Assistant".into(),
        }
    }

    #[test]
    fn a_proposal_writes_nothing_until_applied() {
        let vault = super::super::tests::vault("proposals-apply");
        let shard = vault.root.join("Plan.md");
        std::fs::write(&shard, "# Plan\n\n- One\n- Two\n").unwrap();
        let ops = [
            op(
                "edit_shard",
                json!({ "path": "Plan.md", "action": "replace", "find": "- One", "replace_with": "- [x] One", "summary": "Ticked One" }),
            ),
            op(
                "edit_shard",
                json!({ "path": "Plan.md", "action": "append", "text": "Done soon." }),
            ),
        ];
        let target = target(&vault, &ops[0]).unwrap();
        assert_eq!(
            target,
            Target {
                kind: Kind::Shard,
                path: "Plan.md".into()
            }
        );
        assert!(adds_to(&target, &super::target(&vault, &ops[1]).unwrap()));

        let after = replay(&vault, current(&vault, &target), &ops).unwrap();
        assert_eq!(after, "# Plan\n\n- [x] One\n- Two\n\nDone soon.\n");
        assert_eq!(
            std::fs::read_to_string(&shard).unwrap(),
            "# Plan\n\n- One\n- Two\n"
        );
        assert_eq!(summaries(&ops), vec!["Ticked One".to_string()]);

        // Not the text the app shows: nothing is written.
        assert!(apply(&vault, &caller(), None, &target, &ops, Some("Other")).is_err());
        let applied = apply(
            &vault,
            &caller(),
            Some("Ticked One (Claude)"),
            &target,
            &ops,
            None,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), after);
        assert_eq!(applied.len(), 1);
        let history = list_versions(&vault.sync_root, &vault.root, &shard).unwrap();
        let now = history.current.unwrap();
        assert_eq!(now.kind, VersionKind::ChangedByApp);
        assert_eq!(now.changed_by.as_deref(), Some("Assistant"));
        assert_eq!(now.summary.as_deref(), Some("Ticked One (Claude)"));

        undo(&vault, &caller(), Some("Undid it"), &applied).unwrap();
        assert_eq!(
            std::fs::read_to_string(&shard).unwrap(),
            "# Plan\n\n- One\n- Two\n"
        );
        let history = list_versions(&vault.sync_root, &vault.root, &shard).unwrap();
        assert_eq!(
            history.current.unwrap().summary.as_deref(),
            Some("Undid it")
        );
    }

    #[test]
    fn a_move_says_where_it_goes() {
        let moved = [op(
            "move",
            json!({ "path": "Plans", "to_folder": "Archive" }),
        )];
        assert_eq!(
            moving(&moved),
            Some(Moving {
                folder: Some("Archive".into()),
                name: None
            })
        );
        let renamed = [op("move", json!({ "path": "Plan.md", "new_name": "Trip" }))];
        assert_eq!(moving(&renamed).unwrap().name.as_deref(), Some("Trip"));
        let edited = [op("edit_shard", json!({ "path": "Plan.md" }))];
        assert_eq!(moving(&edited), None);
    }

    #[test]
    fn applying_runs_the_calls_on_the_shard_as_it_is_then() {
        let vault = super::super::tests::vault("proposals-rebase");
        let shard = vault.root.join("Plan.md");
        std::fs::write(&shard, "Alpha\n\nBeta\n").unwrap();
        let ops = [op(
            "edit_shard",
            json!({ "path": "Plan.md", "action": "replace", "find": "Beta", "replace_with": "Gamma" }),
        )];
        let target = target(&vault, &ops[0]).unwrap();
        std::fs::write(&shard, "Alpha, edited\n\nBeta\n").unwrap();
        apply(&vault, &caller(), None, &target, &ops, None).unwrap();
        assert_eq!(
            std::fs::read_to_string(&shard).unwrap(),
            "Alpha, edited\n\nGamma\n"
        );

        // The text it changes is gone: it doesn't fit anymore.
        std::fs::write(&shard, "Alpha\n").unwrap();
        let error = apply(&vault, &caller(), None, &target, &ops, None).unwrap_err();
        assert!(error.0.starts_with("Plan changed since"), "{}", error.0);
        assert_eq!(std::fs::read_to_string(&shard).unwrap(), "Alpha\n");
    }

    #[test]
    fn a_new_shard_is_made_on_apply_and_its_undo_leaves_nothing() {
        let vault = super::super::tests::vault("proposals-new");
        let ops = [
            op(
                "create_shard",
                json!({ "folder": "Notes", "name": "Ideas", "content": "# Ideas\n" }),
            ),
            op(
                "edit_shard",
                json!({ "path": "Notes/Ideas.md", "action": "append", "text": "One" }),
            ),
        ];
        let target = target(&vault, &ops[0]).unwrap();
        assert_eq!(
            target,
            Target {
                kind: Kind::NewShard,
                path: "Notes/Ideas.md".into()
            }
        );
        assert!(adds_to(&target, &super::target(&vault, &ops[1]).unwrap()));
        assert!(!vault.root.join("Notes/Ideas.md").exists());

        let applied = apply(&vault, &caller(), None, &target, &ops, None).unwrap();
        let made = vault.root.join("Notes/Ideas.md");
        assert_eq!(std::fs::read_to_string(&made).unwrap(), "# Ideas\n\nOne\n");
        assert_eq!(applied[0].before, None);

        // Edited by hand since: it stays.
        std::fs::write(&made, "Mine").unwrap();
        assert!(undo(&vault, &caller(), None, &applied).is_err());
        assert!(made.exists());
    }

    #[test]
    fn a_move_is_undone_back_to_where_it_was() {
        let vault = super::super::tests::vault("proposals-move");
        std::fs::write(vault.root.join("Plan.md"), "The plan").unwrap();
        let ops = [op(
            "move",
            json!({ "path": "Plan.md", "new_name": "Roadmap.md" }),
        )];
        let target = target(&vault, &ops[0]).unwrap();
        assert_eq!(target.kind, Kind::Move);
        let applied = apply(&vault, &caller(), None, &target, &ops, None).unwrap();
        assert!(vault.root.join("Roadmap.md").is_file());
        assert!(!vault.root.join("Plan.md").exists());

        undo(&vault, &caller(), None, &applied).unwrap();
        assert_eq!(
            std::fs::read_to_string(vault.root.join("Plan.md")).unwrap(),
            "The plan"
        );
        assert!(!vault.root.join("Roadmap.md").exists());
    }

    #[test]
    fn read_tools_are_not_proposals() {
        let vault = super::super::tests::vault("proposals-read");
        assert!(target(&vault, &op("read", json!({ "path": "Plan.md" }))).is_err());
    }
}
