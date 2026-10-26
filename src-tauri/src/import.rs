//! Bringing files from outside the vault in as shards.
//!
//! The app converts each file itself (see `src/lib/import`). This side lists
//! the files a person picked, reads them, and finds free names for the shards
//! they become, so an import never overwrites anything already in the vault.
//! It reads nothing but the picked files, and the attachment folders of the
//! vaults they come from.
//! It also takes an import back when the person asks right after.

use rusqlite::{Connection, params};
use serde::Serialize;
use std::collections::HashSet;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

use crate::db::attachments::{ATTACHMENTS_DIR_NAME, vault_key};
use crate::vault;
use crate::vault_access::is_within;

/// The files and folders picked for the import running now.
pub struct PickedSources {
    picked: Mutex<Vec<PathBuf>>,
}

static PICKED: PickedSources = PickedSources::new();

pub fn picked() -> &'static PickedSources {
    &PICKED
}

impl PickedSources {
    const fn new() -> Self {
        Self {
            picked: Mutex::new(Vec::new()),
        }
    }

    /// Notes what the person just picked in the import dialog, in place of
    /// what they picked before.
    pub fn allow(&self, paths: &[PathBuf]) {
        *self.picked.lock().unwrap_or_else(|e| e.into_inner()) = paths.to_vec();
    }

    /// Checks that an import may read `path`: a picked file, a file in a
    /// picked folder, or a file in an `_attachments` folder above one, where
    /// shards from another vault keep their pictures.
    pub fn check(&self, path: &Path) -> Result<(), String> {
        let picked = self.picked.lock().unwrap_or_else(|e| e.into_inner());
        let allowed = picked.iter().any(|source| {
            is_within(source, path)
                || source
                    .ancestors()
                    .skip(1)
                    .any(|folder| is_within(&folder.join(ATTACHMENTS_DIR_NAME), path))
        });
        if allowed {
            Ok(())
        } else {
            Err(format!("{} wasn't picked for import", path.display()))
        }
    }
}

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

/// Claims a new `.md` file inside `vault_root` for an imported shard: `path`,
/// or when something took that name since it was reserved, the first free
/// `_1`, `_2`, … after it. Creates its folders and returns where it is.
pub fn prepare_new_shard(vault_root: &Path, path: &Path) -> Result<PathBuf, String> {
    if !vault::is_markdown_path(path) {
        return Err(format!("Not a shard: {}", path.display()));
    }
    if path.components().any(|c| matches!(c, Component::ParentDir)) || !path.starts_with(vault_root) {
        return Err(format!("{} is outside the vault", path.display()));
    }
    let parent = path.parent().ok_or_else(|| format!("Not a shard: {}", path.display()))?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create folder {}: {}", parent.display(), e))?;

    let stem = path.file_stem().unwrap_or_default().to_string_lossy().into_owned();
    let candidates = std::iter::once(path.to_path_buf())
        .chain((1..).map(|n| parent.join(format!("{}_{}.md", stem, n))));
    for candidate in candidates {
        match std::fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(_) => return Ok(candidate),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("Failed to create {}: {}", candidate.display(), e)),
        }
    }
    unreachable!("an endless list of names")
}

/// Removes the folders an undone import leaves empty, from each shard's
/// folder up to `target_dir`, which stays.
pub fn remove_empty_folders(target_dir: &Path, shard_paths: &[PathBuf]) {
    for shard in shard_paths {
        let mut dir = shard.parent();
        while let Some(current) = dir {
            if current == target_dir || !current.starts_with(target_dir) || std::fs::remove_dir(current).is_err() {
                break;
            }
            dir = current.parent();
        }
    }
}

/// Of the attachments an import linked (`asset_paths`), moves to the trash
/// with `remove` the ones it brought in (added at or after `since`, unix
/// seconds) that no shard links to any more. Files that were already in the
/// vault stay. Returns the ones removed.
pub fn remove_new_attachments(
    conn: &Connection,
    vault_root: &Path,
    asset_paths: &[String],
    since: i64,
    remove: impl Fn(&Path) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    for asset_path in asset_paths {
        let relative = Path::new(asset_path);
        let inside = relative.starts_with(ATTACHMENTS_DIR_NAME)
            && relative.components().all(|c| matches!(c, Component::Normal(_)));
        if !inside {
            continue;
        }
        let unused_and_new: bool = conn
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM attachments WHERE vault_path = ?3 AND asset_path = ?1 AND created_at >= ?2 AND ref_count = 0)",
                params![asset_path, since, vault_key(vault_root)],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to check attachment {}: {}", asset_path, e))?;
        if !unused_and_new {
            continue;
        }
        let path = vault_root.join(relative);
        if path.exists() {
            remove(&path)?;
        }
        conn.execute(
            "DELETE FROM attachments WHERE vault_path = ?2 AND asset_path = ?1 AND ref_count = 0",
            params![asset_path, vault_key(vault_root)],
        )
        .map_err(|e| format!("Failed to forget attachment {}: {}", asset_path, e))?;
        removed.push(asset_path.clone());
    }
    Ok(removed)
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
    fn a_name_taken_since_it_was_reserved_moves_to_the_next_free_one() {
        let vault = temp_dir("prepare");
        std::fs::write(vault.join("Taken.md"), "x").unwrap();
        std::fs::write(vault.join("Taken_1.md"), "y").unwrap();

        assert_eq!(prepare_new_shard(&vault, &vault.join("Taken.md")).unwrap(), vault.join("Taken_2.md"));
        assert_eq!(std::fs::read_to_string(vault.join("Taken.md")).unwrap(), "x");
        assert!(prepare_new_shard(&vault, &vault.join("../Escape.md")).is_err());
        assert!(prepare_new_shard(&vault, &vault.join("Notes.txt")).is_err());
        assert_eq!(prepare_new_shard(&vault, &vault.join("Deep/New.md")).unwrap(), vault.join("Deep/New.md"));
        assert!(vault.join("Deep").is_dir());
    }

    #[test]
    fn imports_read_only_what_was_picked_and_attachment_folders_above_it() {
        let root = temp_dir("picked");
        let vault = root.join("Other vault");
        let picked = PickedSources::new();
        picked.allow(&[vault.join("Notes"), root.join("Single.docx")]);

        assert!(picked.check(&vault.join("Notes/Plans/Q3.md")).is_ok());
        assert!(picked.check(&root.join("Single.docx")).is_ok());
        assert!(picked.check(&vault.join("_attachments/photo.png")).is_ok());
        assert!(picked.check(&root.join("_attachments/scan.pdf")).is_ok());
        assert!(picked.check(&vault.join("Private/Diary.md")).is_err());
        assert!(picked.check(&root.join("Other.docx")).is_err());
        assert!(picked.check(&vault.join("Notes/../Private/Diary.md")).is_err());

        picked.allow(&[root.join("Single.docx")]);
        assert!(picked.check(&vault.join("Notes/Plans/Q3.md")).is_err());
    }

    #[test]
    fn undo_removes_only_the_folders_and_attachments_the_import_added() {
        let vault = temp_dir("undo");
        std::fs::create_dir_all(vault.join("Notes/Trip")).unwrap();
        std::fs::create_dir_all(vault.join("Kept")).unwrap();
        std::fs::write(vault.join("Kept/Other.md"), "x").unwrap();
        remove_empty_folders(&vault, &[vault.join("Notes/Trip/Day.md"), vault.join("Kept/New.md")]);
        assert!(!vault.join("Notes").exists());
        assert!(vault.join("Kept/Other.md").exists());
        assert!(vault.is_dir());

        std::fs::create_dir_all(vault.join("_attachments")).unwrap();
        for name in ["old.png", "new.png", "used.png"] {
            std::fs::write(vault.join("_attachments").join(name), name).unwrap();
        }
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        for (name, created_at, ref_count) in [("old.png", 100, 0), ("new.png", 200, 0), ("used.png", 200, 1)] {
            conn.execute(
                "INSERT INTO attachments (vault_path, asset_path, hash, original_name, extension, mime_type, size_bytes, created_at, updated_at, sync_status, ref_count)
                 VALUES (?4, ?1, ?1, ?1, 'png', 'image/png', 1, ?2, ?2, 'syncable', ?3)",
                params![format!("_attachments/{}", name), created_at, ref_count, vault_key(&vault)],
            )
            .unwrap();
        }

        let assets: Vec<String> = ["old.png", "new.png", "used.png", "../escape.png"]
            .iter()
            .map(|name| format!("_attachments/{}", name))
            .collect();
        let removed = remove_new_attachments(&conn, &vault, &assets, 150, |path| {
            std::fs::remove_file(path).map_err(|e| e.to_string())
        })
        .unwrap();

        assert_eq!(removed, vec!["_attachments/new.png".to_string()]);
        assert!(!vault.join("_attachments/new.png").exists());
        assert!(vault.join("_attachments/old.png").exists());
        assert!(vault.join("_attachments/used.png").exists());
    }
}
