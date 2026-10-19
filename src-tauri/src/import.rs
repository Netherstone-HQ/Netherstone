//! Bringing files from outside the vault in as shards.
//!
//! The app converts each file itself (see `src/lib/import`). This side lists
//! the files a person picked, reads them, and finds free names for the shards
//! they become, so an import never overwrites anything already in the vault.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};

use crate::vault;

/// A file found among the picked files and folders.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportSourceFile {
    /// Absolute path on disk.
    pub path: String,
    /// Path from the picked folder's parent, with `/` separators, so a picked
    /// folder `Notes` gives `Notes/Plans/Q3.docx`. A picked file is its name.
    pub relative_path: String,
    pub size: u64,
}

/// Lists every file in `paths`, descending into folders. Hidden entries and
/// known noise (`.git`, `.obsidian`, …) are skipped; which files can be
/// imported is the app's call.
pub fn list_sources(paths: &[PathBuf]) -> Vec<ImportSourceFile> {
    let mut files = Vec::new();

    for path in paths {
        if path.is_file() {
            push_file(&mut files, path, file_name(path));
        } else if path.is_dir() {
            walk(&mut files, path, file_name(path));
        }
    }

    files
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn push_file(files: &mut Vec<ImportSourceFile>, path: &Path, relative_path: String) {
    let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    files.push(ImportSourceFile {
        path: path.to_string_lossy().into_owned(),
        relative_path,
        size,
    });
}

fn walk(files: &mut Vec<ImportSourceFile>, dir: &Path, prefix: String) {
    let mut entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries.filter_map(|e| e.ok()).collect::<Vec<_>>(),
        Err(_) => return,
    };
    entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());

    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        let path = entry.path();
        let relative = format!("{}/{}", prefix, name);
        // Symlinked folders are not followed, so a link loop can't hang an import.
        let is_symlink = entry.file_type().map(|t| t.is_symlink()).unwrap_or(false);
        if path.is_dir() && !is_symlink {
            walk(files, &path, relative);
        } else if path.is_file() {
            push_file(files, &path, relative);
        }
    }
}

/// One path segment made safe to use as a file or folder name everywhere.
fn clean_segment(segment: &str) -> String {
    let cleaned: String = segment
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '-'
            } else {
                c
            }
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() || trimmed == ".." {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Finds a free `.md` path inside `target_dir` for each of `relative_paths`
/// (`Folder/Name`, without extension), in order. A name taken on disk or
/// earlier in the same list gets `_1`, `_2`, … like other new files.
pub fn reserve_shard_paths(target_dir: &Path, relative_paths: &[String]) -> Result<Vec<String>, String> {
    if !target_dir.is_dir() {
        return Err(format!("Not a directory: {}", target_dir.display()));
    }

    let mut taken: HashSet<String> = HashSet::new();
    let mut reserved = Vec::with_capacity(relative_paths.len());

    for relative in relative_paths {
        let segments: Vec<String> = relative
            .split(['/', '\\'])
            .filter(|s| !s.trim().is_empty() && *s != ".")
            .map(clean_segment)
            .collect();
        let (name, folders) = match segments.split_last() {
            Some((name, folders)) => (name.clone(), folders.to_vec()),
            None => ("Untitled".to_string(), Vec::new()),
        };

        let mut dir = target_dir.to_path_buf();
        for folder in folders {
            dir.push(folder);
        }

        let mut candidate = dir.join(format!("{}.md", name));
        let mut counter: u32 = 1;
        while candidate.exists() || taken.contains(&key(&candidate)) {
            candidate = dir.join(format!("{}_{}.md", name, counter));
            counter += 1;
        }

        taken.insert(key(&candidate));
        reserved.push(candidate.to_string_lossy().into_owned());
    }

    Ok(reserved)
}

/// Names compare case-insensitively: Windows and macOS treat them that way.
fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

/// Checks that `path` is a new `.md` file inside `vault_root` and creates its
/// folders, ready for the shard to be written.
pub fn prepare_new_shard(vault_root: &Path, path: &Path) -> Result<(), String> {
    if !vault::is_markdown_path(path) {
        return Err(format!("Not a shard: {}", path.display()));
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) || !path.starts_with(vault_root) {
        return Err(format!("{} is outside the vault", path.display()));
    }
    if path.exists() {
        return Err(format!("{} already exists", path.display()));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create folder {}: {}", parent.display(), e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("netherstone-import-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn lists_files_in_picked_folders_with_their_folder_name() {
        let root = temp_dir("list");
        let notes = root.join("Notes");
        std::fs::create_dir_all(notes.join("Plans")).unwrap();
        std::fs::create_dir_all(notes.join(".obsidian")).unwrap();
        std::fs::write(notes.join("a.md"), "a").unwrap();
        std::fs::write(notes.join("Plans/b.docx"), "b").unwrap();
        std::fs::write(notes.join(".obsidian/app.json"), "{}").unwrap();
        std::fs::write(root.join("single.pdf"), "pdf").unwrap();

        let files = list_sources(&[notes.clone(), root.join("single.pdf")]);
        let relative: Vec<&str> = files.iter().map(|f| f.relative_path.as_str()).collect();

        assert_eq!(relative, vec!["Notes/a.md", "Notes/Plans/b.docx", "single.pdf"]);
        assert_eq!(files[2].size, 3);
    }

    #[test]
    fn reserves_free_names_without_overwriting() {
        let vault = temp_dir("reserve");
        std::fs::write(vault.join("Report.md"), "existing").unwrap();

        let paths = reserve_shard_paths(
            &vault,
            &["Report".into(), "Report".into(), "Notes/Plan".into(), "Bad:Name?".into()],
        )
        .unwrap();

        assert_eq!(
            paths,
            vec![
                vault.join("Report_1.md").to_string_lossy(),
                vault.join("Report_2.md").to_string_lossy(),
                vault.join("Notes").join("Plan.md").to_string_lossy(),
                vault.join("Bad-Name-.md").to_string_lossy(),
            ]
        );
    }

    #[test]
    fn refuses_paths_outside_the_vault_or_already_there() {
        let vault = temp_dir("prepare");
        std::fs::write(vault.join("Taken.md"), "x").unwrap();

        assert!(prepare_new_shard(&vault, &vault.join("Taken.md")).is_err());
        assert!(prepare_new_shard(&vault, &vault.join("../Escape.md")).is_err());
        assert!(prepare_new_shard(&vault, &vault.join("Deep/New.md")).is_ok());
        assert!(vault.join("Deep").is_dir());
    }
}
