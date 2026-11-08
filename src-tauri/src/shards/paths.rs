//! New folders, renames, moves and deletes, with the links and caches that
//! follow them.

use super::write_shard;
use crate::vault_access::{self, in_open_vault};
use crate::{db, locks, shard_links, vault};
use std::path::Path;

fn collect_markdown_file_paths(path: &Path) -> Result<Vec<String>, String> {
    let mut markdown_paths = Vec::new();

    if path.is_file() {
        if vault::is_markdown_path(path) {
            markdown_paths.push(path.to_string_lossy().to_string());
        }

        return Ok(markdown_paths);
    }

    if path.is_dir() {
        let entries = std::fs::read_dir(path)
            .map_err(|e| format!("Failed to read directory {}: {}", path.display(), e))?;

        for entry in entries {
            let entry = entry.map_err(|e| {
                format!(
                    "Failed to read directory entry in {}: {}",
                    path.display(),
                    e
                )
            })?;
            let child_path = entry.path();
            markdown_paths.extend(collect_markdown_file_paths(&child_path)?);
        }
    }

    Ok(markdown_paths)
}

/// Creates the folder `name` inside `parent` and returns its path.
#[tauri::command(async)]
pub(crate) fn create_folder(parent: String, name: String) -> Result<String, String> {
    in_open_vault(&parent)?;
    let _writes = locks::vault_writes()?;
    vault::create_folder(Path::new(&parent), &name).map(|p| p.to_string_lossy().into_owned())
}

/// The (old, new) path of every shard affected when `old_path` became
/// `new_path`: the shard itself, or each shard inside a folder.
fn moved_markdown_paths(old_path: &str, new_path: &Path) -> Vec<(String, String)> {
    if !new_path.is_dir() {
        return vec![(old_path.to_string(), new_path.to_string_lossy().to_string())];
    }

    let Ok(moved) = collect_markdown_file_paths(new_path) else {
        return Vec::new();
    };

    moved
        .into_iter()
        .filter_map(|moved_path| {
            let relative = Path::new(&moved_path).strip_prefix(new_path).ok()?;
            let previous = Path::new(old_path).join(relative);
            Some((previous.to_string_lossy().to_string(), moved_path))
        })
        .collect()
}

/// Points the AST cache and attachment references at the new paths after a
/// rename or move, so a folder takes the cached state of its shards along.
fn sync_caches_after_path_change(old_path: &str, new_path: &Path, action: &str) {
    let conn = match db::open_connection() {
        Ok(conn) => conn,
        Err(error) => {
            eprintln!(
                "[Netherstone] Failed to open database after {} {} -> {}: {}",
                action,
                old_path,
                new_path.display(),
                error
            );
            return;
        }
    };

    for (previous, next) in moved_markdown_paths(old_path, new_path) {
        if let Err(error) = db::ast_cache::rename_ast_cache(&conn, &previous, &next) {
            eprintln!(
                "[Netherstone] Failed to update AST cache {} -> {}: {}",
                previous, next, error
            );
        }

        if let Err(error) = db::attachments::rename_reference_file_path(&conn, &previous, &next) {
            eprintln!(
                "[Netherstone] Failed to update attachment references {} -> {}: {}",
                previous, next, error
            );
        }

        if let Err(error) = db::data::rename_writing_path(&conn, &previous, &next) {
            eprintln!(
                "[Netherstone] Failed to update the writing log {} -> {}: {}",
                previous, next, error
            );
        }
    }
}

/// Rewrites the links between shards after `old_path` became `new_path`:
/// the moved shards' own relative links, and the links to them in the
/// shards the index knows link there. Rewritten files are re-indexed and
/// their cached editor state dropped, since it names the old paths.
fn rewrite_links_after_path_change(vault: &Path, old_path: &str, new_path: &Path, action: &str) {
    let moved: Vec<shard_links::MovedShard> = moved_markdown_paths(old_path, new_path)
        .into_iter()
        .filter(|(_, new)| vault::is_markdown_path(Path::new(new)))
        .map(|(old, new)| shard_links::MovedShard { old, new })
        .collect();
    if moved.is_empty() {
        return;
    }

    let conn = match db::open_connection() {
        Ok(conn) => conn,
        Err(error) => {
            eprintln!(
                "[Netherstone] Failed to open database to rewrite links after {}: {}",
                action, error
            );
            return;
        }
    };

    let mut files: Vec<(String, String)> = moved
        .iter()
        .map(|m| (m.old.clone(), m.new.clone()))
        .collect();
    let shards: Vec<db::queries::LinkedShard> = moved
        .iter()
        .map(|m| db::queries::LinkedShard::new(&m.old))
        .collect();
    match db::queries::files_linking_to_any(&conn, vault, &shards) {
        Ok(linking) => {
            for path in linking {
                let is_moved = moved.iter().any(|m| {
                    m.old
                        .replace('\\', "/")
                        .eq_ignore_ascii_case(&path.replace('\\', "/"))
                        || m.new
                            .replace('\\', "/")
                            .eq_ignore_ascii_case(&path.replace('\\', "/"))
                });
                if !is_moved {
                    files.push((path.clone(), path));
                }
            }
        }
        Err(error) => eprintln!(
            "[Netherstone] Failed to find shards linking to moved files after {}: {}",
            action, error
        ),
    }

    for (file_old, file_new) in files {
        // Read and written under one lock, so an edit in between isn't lost.
        let writes = match locks::vault_writes() {
            Ok(writes) => writes,
            Err(error) => {
                eprintln!(
                    "[Netherstone] Failed to rewrite links in {} after {}: {}",
                    file_new, action, error
                );
                continue;
            }
        };
        let content = match std::fs::read_to_string(&file_new) {
            Ok(content) => content,
            Err(error) => {
                eprintln!(
                    "[Netherstone] Failed to read {} to rewrite links after {}: {}",
                    file_new, action, error
                );
                continue;
            }
        };
        let Some(rewritten) =
            shard_links::rewrite_moved_links(&content, &file_old, &file_new, &moved)
        else {
            continue;
        };
        if let Err(error) = write_shard(&writes, vault, &file_new, &rewritten) {
            eprintln!(
                "[Netherstone] Failed to rewrite links in {} after {}: {}",
                file_new, action, error
            );
            continue;
        }
        if let Err(error) = db::ast_cache::delete_ast_cache(&conn, &file_new) {
            eprintln!(
                "[Netherstone] Failed to drop the cached editor state of {}: {}",
                file_new, error
            );
        }
        if let Err(error) = db::indexer::index_file(&conn, vault, Path::new(&file_new)) {
            eprintln!(
                "[Netherstone] Failed to re-index {} after rewriting links: {}",
                file_new, error
            );
        }
        eprintln!(
            "[Netherstone] Rewrote shard links in {} after {} {} -> {}",
            file_new,
            action,
            old_path,
            new_path.display()
        );
    }
}

#[tauri::command(async)]
pub(crate) fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    vault_access::get().check_inside(Path::new(&old_path))?;
    rename_path(&vault_access::get().open_vault()?, &old_path, new_name)
}

/// Renames the shard, drawing or folder at `old_path` in `vault` and points
/// the links to the shards it holds at the new name.
pub(crate) fn rename_path(
    vault: &Path,
    old_path: &str,
    new_name: String,
) -> Result<String, String> {
    let old_file = std::path::Path::new(old_path);

    let writes = locks::vault_writes()?;
    if !old_file.exists() {
        return Err(format!("File does not exist: {}", old_path));
    }

    let is_directory = old_file.is_dir();

    // Shards and drawings keep their extension when renamed without one.
    let kept_extension = if !old_file.is_file() {
        None
    } else if vault::is_markdown_path(old_file) {
        Some("md")
    } else if vault::is_drawing_path(old_file) {
        Some(vault::DRAWING_EXTENSION)
    } else {
        None
    };

    let resolved_new_name = match kept_extension {
        Some(ext) if !Path::new(&new_name).extension().is_some_and(|e| e == ext) => {
            format!("{}.{}", new_name, ext)
        }
        _ => new_name,
    };

    let parent = old_file.parent().ok_or("Cannot get parent directory")?;
    let new_path = parent.join(&resolved_new_name);
    let mut parts = Path::new(&resolved_new_name).components();
    if !matches!(
        (parts.next(), parts.next()),
        (Some(std::path::Component::Normal(_)), None)
    ) {
        return Err(format!("'{}' can't be used as a name", resolved_new_name));
    }
    let old_path_normalized = old_file.to_string_lossy();
    let new_path_normalized = new_path.to_string_lossy();
    let is_case_only_rename = old_path_normalized.eq_ignore_ascii_case(&new_path_normalized)
        && old_path_normalized != new_path_normalized;

    if new_path.exists() && !is_case_only_rename {
        return Err(format!(
            "A {} with name '{}' already exists",
            if is_directory { "folder" } else { "file" },
            resolved_new_name
        ));
    }

    // Rename the file or directory
    std::fs::rename(old_file, &new_path).map_err(|e| format!("Failed to rename file: {}", e))?;
    // Released first: rewriting links takes the lock for each shard.
    drop(writes);

    let new_path_string = new_path.to_string_lossy().to_string();
    sync_caches_after_path_change(old_path, &new_path, "rename");
    rewrite_links_after_path_change(vault, old_path, &new_path, "rename");

    Ok(new_path_string)
}

#[tauri::command(async)]
pub(crate) fn move_file(source_path: String, destination_dir: String) -> Result<String, String> {
    vault_access::get().check_inside(Path::new(&source_path))?;
    in_open_vault(&destination_dir)?;
    move_path(
        &vault_access::get().open_vault()?,
        &source_path,
        &destination_dir,
    )
}

/// Moves the shard, drawing or folder at `source_path` in `vault` into
/// `destination_dir` and points the links to the shards it holds there.
pub(crate) fn move_path(
    vault: &Path,
    source_path: &str,
    destination_dir: &str,
) -> Result<String, String> {
    let source = std::path::Path::new(source_path);
    let dest_dir = std::path::Path::new(destination_dir);

    let writes = locks::vault_writes()?;
    if !source.exists() {
        return Err(format!("Source file does not exist: {}", source_path));
    }

    let kind = if source.is_dir() { "folder" } else { "file" };

    if !dest_dir.is_dir() {
        return Err(format!(
            "Destination is not a directory: {}",
            destination_dir
        ));
    }

    if source.is_dir() && dest_dir.starts_with(source) {
        return Err("A folder can't be moved into itself.".to_string());
    }

    let file_name = source.file_name().ok_or("Cannot get file name")?;

    let new_path = dest_dir.join(file_name);

    if new_path.exists() {
        return Err(format!(
            "A {} with name '{}' already exists in destination",
            kind,
            file_name.to_string_lossy()
        ));
    }

    std::fs::rename(source, &new_path).map_err(|e| format!("Failed to move {}: {}", kind, e))?;
    // Released first: rewriting links takes the lock for each shard.
    drop(writes);

    let new_path_string = new_path.to_string_lossy().to_string();
    sync_caches_after_path_change(source_path, &new_path, "move");
    rewrite_links_after_path_change(vault, source_path, &new_path, "move");

    Ok(new_path_string)
}

#[tauri::command(async)]
pub(crate) fn delete_vault_path(target_path: String) -> Result<(), String> {
    vault_access::get().check_inside(Path::new(&target_path))?;
    delete_path(Path::new(&target_path))
}

/// Moves a shard, drawing or folder to the OS trash and forgets the shards'
/// cached state.
pub(crate) fn delete_path(target: &Path) -> Result<(), String> {
    let target_path = target.to_string_lossy();
    let writes = locks::vault_writes()?;
    if !target.exists() {
        return Err(format!("Path does not exist: {}", target_path));
    }

    let markdown_paths = collect_markdown_file_paths(target)?;

    trash::delete(target)
        .map_err(|e| format!("Failed to move {} to the OS trash: {}", target_path, e))?;
    drop(writes);

    match db::open_connection() {
        Ok(conn) => {
            for markdown_path in markdown_paths {
                match db::ast_cache::delete_ast_cache(&conn, &markdown_path) {
                    Ok(deleted) => {
                        eprintln!(
                            "[Netherstone] AST cache sync after delete {} path={}",
                            if deleted { "deleted" } else { "noop" },
                            markdown_path
                        );
                    }
                    Err(error) => {
                        eprintln!(
                            "[Netherstone] Failed to delete AST cache for {}: {}",
                            markdown_path, error
                        );
                    }
                }

                if let Err(error) =
                    db::attachments::remove_references_for_markdown_file(&conn, &markdown_path)
                {
                    eprintln!(
                        "[Netherstone] Failed to remove attachment references for {}: {}",
                        markdown_path, error
                    );
                }
            }
        }
        Err(error) => {
            eprintln!(
                "[Netherstone] Failed to open database while deleting {}: {}",
                target_path, error
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn moved_markdown_paths_maps_every_shard_in_a_folder() {
        let dir = std::env::temp_dir().join(format!("netherstone-moved-{}", std::process::id()));
        let moved = dir.join("Archive").join("Work");
        std::fs::create_dir_all(moved.join("2026")).unwrap();
        std::fs::write(moved.join("Plan.md"), "").unwrap();
        std::fs::write(moved.join("2026").join("Notes.md"), "").unwrap();
        std::fs::write(moved.join("Sketch.excalidraw"), "").unwrap();

        let old_root = dir.join("Work");
        let mut pairs = moved_markdown_paths(&old_root.to_string_lossy(), &moved);
        pairs.sort();
        std::fs::remove_dir_all(&dir).unwrap();

        let expected = |relative: &[&str]| {
            let from = relative
                .iter()
                .fold(old_root.clone(), |p, part| p.join(part));
            let to = relative.iter().fold(moved.clone(), |p, part| p.join(part));
            (
                from.to_string_lossy().to_string(),
                to.to_string_lossy().to_string(),
            )
        };
        let mut wanted = vec![expected(&["2026", "Notes.md"]), expected(&["Plan.md"])];
        wanted.sort();
        assert_eq!(pairs, wanted);
    }

    #[test]
    fn move_file_refuses_to_move_a_folder_into_itself() {
        let dir = std::env::temp_dir().join(format!("netherstone-into-{}", std::process::id()));
        let inner = dir.join("Work").join("Inner");
        std::fs::create_dir_all(&inner).unwrap();

        let result = move_path(
            &dir,
            &dir.join("Work").to_string_lossy(),
            &inner.to_string_lossy(),
        );
        let still_there = inner.is_dir();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(result.is_err());
        assert!(still_there);
    }

    #[test]
    fn rename_keeps_the_new_name_in_the_same_folder() {
        let dir = std::env::temp_dir().join(format!("netherstone-rename-{}", std::process::id()));
        let folder = dir.join("Work");
        std::fs::create_dir_all(&folder).unwrap();
        let shard = folder.join("Plan.md");
        std::fs::write(&shard, "plan").unwrap();
        let shard_path = shard.to_string_lossy().into_owned();

        let escapes = [
            rename_path(&dir, &shard_path, "../Plan".into()),
            rename_path(&dir, &shard_path, "Sub/Plan".into()),
            rename_path(&dir, &folder.to_string_lossy(), "..".into()),
        ];
        let renamed = rename_path(&dir, &shard_path, "Roadmap".into()).unwrap();
        let moved_out = dir.join("Plan.md").exists();
        std::fs::remove_dir_all(&dir).unwrap();

        assert!(escapes.iter().all(Result::is_err));
        assert!(!moved_out);
        assert_eq!(Path::new(&renamed), folder.join("Roadmap.md"));
    }
}
