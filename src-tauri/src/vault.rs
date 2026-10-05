use serde::Serialize;
use std::path::Path;
use std::path::PathBuf;

// ── Dialog Results ────────────────────────────────────────────────────────────

/// Returned by `open_shard_dialog`. Contains the picked file and its parent
/// directory, which becomes the vault root if the file is outside the current vault.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShardDialogResult {
    pub file_path: String,
    pub vault_path: String,
}

// ── Types ────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub kind: FileNodeKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileNodeKind {
    File,
    Directory,
}

// ── Constants ────────────────────────────────────────────────────────────────

/// Directory/file names that are always skipped during scanning.
const IGNORED_NAMES: &[&str] = &[
    ".git",
    ".DS_Store",
    ".obsidian",
    ".trash",
    "node_modules",
    "_attachments",
];

/// Extension of Excalidraw drawings stored in the vault.
pub const DRAWING_EXTENSION: &str = "excalidraw";

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case(extension))
}

pub fn is_markdown_path(path: &Path) -> bool {
    has_extension(path, "md")
}

pub fn is_drawing_path(path: &Path) -> bool {
    has_extension(path, DRAWING_EXTENSION)
}

/// Files shown in the vault tree: shards and drawings.
pub fn is_vault_document_path(path: &Path) -> bool {
    is_markdown_path(path) || is_drawing_path(path)
}

// ── Scanner ──────────────────────────────────────────────────────────────────

/// Recursively scans `dir` and returns a sorted list of [`FileNode`]s.
///
/// Rules:
/// - Hidden entries (names starting with `.`) are skipped.
/// - Entries in [`IGNORED_NAMES`] are skipped.
/// - Only `.md` shards and `.excalidraw` drawings are included.
/// - A directory node is emitted if it contains at least one of those
///   (directly or transitively), or nothing at all, so a folder just made in
///   the app shows up while folders of only images or other files stay out.
/// - Results are sorted: directories first, then files, both case-insensitively.
pub fn scan_dir(dir: &Path) -> Vec<FileNode> {
    let mut entries = match std::fs::read_dir(dir) {
        Ok(rd) => rd.filter_map(|e| e.ok()).collect::<Vec<_>>(),
        Err(_) => return vec![],
    };

    // Directories before files; ties broken by case-insensitive name.
    entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a
                .file_name()
                .to_ascii_lowercase()
                .cmp(&b.file_name().to_ascii_lowercase()),
        }
    });

    let mut nodes = Vec::new();

    for entry in entries {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden entries and known noise.
        if name.starts_with('.') || IGNORED_NAMES.contains(&name.as_str()) {
            continue;
        }

        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            let children = scan_dir(&path);
            if !children.is_empty() || is_empty_dir(&path) {
                nodes.push(FileNode {
                    name,
                    path: path.to_string_lossy().to_string(),
                    kind: FileNodeKind::Directory,
                    children: Some(children),
                });
            }
        } else if file_type.is_file() && is_vault_document_path(&path) {
            nodes.push(FileNode {
                name,
                path: path.to_string_lossy().to_string(),
                kind: FileNodeKind::File,
                children: None,
            });
        }
    }

    nodes
}

fn is_empty_dir(path: &Path) -> bool {
    std::fs::read_dir(path).is_ok_and(|mut entries| entries.next().is_none())
}

// ── Importer ─────────────────────────────────────────────────────────────────

/// Copies `source` into `vault_root`, returning the path of the new file.
///
/// If a file with the same name already exists at the destination, a numeric
/// suffix is appended before the extension until a free name is found:
/// `shard.md` → `shard_1.md` → `shard_2.md` → …
pub fn import_shard_to_vault(source: &Path, vault_root: &Path) -> Result<String, String> {
    let file_name = source
        .file_name()
        .ok_or_else(|| format!("Invalid source path: {}", source.display()))?;

    let mut dest: PathBuf = vault_root.join(file_name);

    // Collision guard — find a free name before touching the filesystem.
    if dest.exists() {
        let stem = source
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("shard");

        let mut counter: u32 = 1;
        loop {
            dest = vault_root.join(format!("{}_{}.md", stem, counter));
            if !dest.exists() {
                break;
            }
            counter += 1;
        }
    }

    std::fs::copy(source, &dest).map_err(|e| format!("Failed to copy shard: {}", e))?;

    Ok(dest.to_string_lossy().to_string())
}

// ── Drawings ─────────────────────────────────────────────────────────────────

/// Contents of a newly created drawing: an empty Excalidraw scene.
pub const EMPTY_DRAWING: &str = r#"{
  "type": "excalidraw",
  "version": 2,
  "source": "netherstone",
  "elements": [],
  "appState": {},
  "files": {}
}
"#;

/// Returns a path in `dir` for a new drawing named `name`, appending a numeric
/// suffix when the name is taken: `Sketch.excalidraw` → `Sketch_1.excalidraw`.
pub fn unique_drawing_path(dir: &Path, name: &str) -> Result<PathBuf, String> {
    let suffix = format!(".{}", DRAWING_EXTENSION);
    let trimmed = name.trim();
    let stem = if trimmed.to_ascii_lowercase().ends_with(&suffix) {
        &trimmed[..trimmed.len() - suffix.len()]
    } else {
        trimmed
    }
    .trim();

    if stem.is_empty() {
        return Err("Drawing name cannot be empty".to_string());
    }
    if stem.contains(['/', '\\']) {
        return Err("Drawing name cannot contain slashes".to_string());
    }

    let mut candidate = dir.join(format!("{}{}", stem, suffix));
    let mut counter: u32 = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{}_{}{}", stem, counter, suffix));
        counter += 1;
    }

    Ok(candidate)
}


/// Why a new vault folder couldn't be made. The app turns each into its own
/// message, so these are codes rather than sentences.
pub const VAULT_NAME_EMPTY: &str = "vault-name-empty";
pub const VAULT_NAME_INVALID: &str = "vault-name-invalid";
pub const VAULT_FOLDER_NOT_EMPTY: &str = "vault-folder-not-empty";
pub const VAULT_LOCATION_MISSING: &str = "vault-location-missing";

/// Whether `name` (already trimmed) can name a folder on every platform.
fn is_valid_folder_name(name: &str) -> bool {
    // Characters no folder name may hold on Windows, which is the strictest.
    name != "."
        && name != ".."
        && !name.ends_with('.')
        && !name
            .chars()
            .any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
}

/// Creates the folder `parent/name` for a new vault and returns its path.
/// An empty folder that is already there is reused; one with anything in it
/// is refused, so a new vault never takes over someone's existing files.
pub fn create_vault_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(VAULT_NAME_EMPTY.to_string());
    }
    if !is_valid_folder_name(name) {
        return Err(VAULT_NAME_INVALID.to_string());
    }
    if !parent.is_dir() {
        return Err(VAULT_LOCATION_MISSING.to_string());
    }

    let folder = parent.join(name);
    if folder.exists() {
        let has_entries = std::fs::read_dir(&folder)
            .map(|mut entries| entries.next().is_some())
            .unwrap_or(true);
        if has_entries || !folder.is_dir() {
            return Err(VAULT_FOLDER_NOT_EMPTY.to_string());
        }
        return Ok(folder);
    }

    std::fs::create_dir(&folder).map_err(|e| e.to_string())?;
    Ok(folder)
}

/// Creates the folder `parent/name` inside a vault and returns its path.
/// Unlike a new vault, an existing folder of that name is never reused.
pub fn create_folder(parent: &Path, name: &str) -> Result<PathBuf, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }
    if !is_valid_folder_name(name) {
        return Err(format!("'{}' can't be used as a folder name", name));
    }
    if !parent.is_dir() {
        return Err(format!("Not a directory: {}", parent.display()));
    }

    let folder = parent.join(name);
    if folder.exists() {
        return Err(format!("A folder with name '{}' already exists", name));
    }

    std::fs::create_dir(&folder).map_err(|e| format!("Failed to create folder: {}", e))?;
    Ok(folder)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netherstone-vault-test-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn create_vault_folder_makes_a_new_folder() {
        let parent = temp_vault("create-new");
        let folder = create_vault_folder(&parent, "  My knowledge ").unwrap();
        assert_eq!(folder, parent.join("My knowledge"));
        assert!(folder.is_dir());
    }

    #[test]
    fn create_vault_folder_reuses_an_empty_folder_only() {
        let parent = temp_vault("create-existing");
        std::fs::create_dir_all(parent.join("Empty")).unwrap();
        std::fs::create_dir_all(parent.join("Full")).unwrap();
        std::fs::write(parent.join("Full/note.md"), "# Note").unwrap();

        assert_eq!(
            create_vault_folder(&parent, "Empty").unwrap(),
            parent.join("Empty")
        );
        assert_eq!(
            create_vault_folder(&parent, "Full").unwrap_err(),
            VAULT_FOLDER_NOT_EMPTY
        );
    }

    #[test]
    fn create_vault_folder_rejects_bad_names_and_locations() {
        let parent = temp_vault("create-invalid");
        assert_eq!(create_vault_folder(&parent, "  ").unwrap_err(), VAULT_NAME_EMPTY);
        for name in ["a/b", "a\\b", "what?", "..", "trailing."] {
            assert_eq!(
                create_vault_folder(&parent, name).unwrap_err(),
                VAULT_NAME_INVALID,
                "{name}"
            );
        }
        assert_eq!(
            create_vault_folder(&parent.join("missing"), "Vault").unwrap_err(),
            VAULT_LOCATION_MISSING
        );
    }

    #[test]
    fn scan_includes_shards_and_drawings_only() {
        let vault = temp_vault("scan");
        std::fs::write(vault.join("note.md"), "# Note").unwrap();
        std::fs::write(vault.join("sketch.excalidraw"), EMPTY_DRAWING).unwrap();
        std::fs::write(vault.join("image.png"), [0u8]).unwrap();
        std::fs::create_dir_all(vault.join("drawings")).unwrap();
        std::fs::write(vault.join("drawings/board.excalidraw"), EMPTY_DRAWING).unwrap();
        std::fs::create_dir_all(vault.join("empty")).unwrap();
        std::fs::create_dir_all(vault.join("images")).unwrap();
        std::fs::write(vault.join("images/photo.png"), [0u8]).unwrap();

        let nodes = scan_dir(&vault);
        let names: Vec<_> = nodes.iter().map(|node| node.name.as_str()).collect();

        assert_eq!(names, vec!["drawings", "empty", "note.md", "sketch.excalidraw"]);
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn create_folder_makes_a_new_folder_only() {
        let vault = temp_vault("new-folder");

        let folder = create_folder(&vault, "  Projects ").unwrap();
        assert_eq!(folder, vault.join("Projects"));
        assert!(folder.is_dir());

        assert!(create_folder(&vault, "Projects").is_err());
        assert!(create_folder(&vault, " ").is_err());
        assert!(create_folder(&vault, "a/b").is_err());
        assert!(create_folder(&vault, "..").is_err());
        assert!(create_folder(&vault.join("missing"), "Projects").is_err());
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn unique_drawing_path_adds_extension_and_avoids_collisions() {
        let vault = temp_vault("unique");

        let first = unique_drawing_path(&vault, "Sketch").unwrap();
        assert_eq!(first, vault.join("Sketch.excalidraw"));
        std::fs::write(&first, EMPTY_DRAWING).unwrap();

        let second = unique_drawing_path(&vault, "Sketch.excalidraw").unwrap();
        assert_eq!(second, vault.join("Sketch_1.excalidraw"));

        assert!(unique_drawing_path(&vault, "  ").is_err());
        assert!(unique_drawing_path(&vault, "a/b").is_err());
        std::fs::remove_dir_all(&vault).unwrap();
    }
}
