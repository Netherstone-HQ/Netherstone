use serde::Serialize;
use std::path::Path;
use std::path::PathBuf;

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

/// False for hidden entries and known noise, which scanning skips.
pub fn is_scanned_name(name: &str) -> bool {
    !name.starts_with('.') && !IGNORED_NAMES.contains(&name)
}

/// Whether `path` is somewhere the vault tree shows: inside `root`, with no
/// hidden or skipped part on the way.
pub fn is_scanned_path(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|relative| {
        relative
            .components()
            .all(|part| is_scanned_name(&part.as_os_str().to_string_lossy()))
    })
}

/// Files shown in the vault tree: shards and drawings.
pub fn is_vault_document_path(path: &Path) -> bool {
    is_markdown_path(path) || is_drawing_path(path)
}

// ── Writing ──────────────────────────────────────────────────────────────────

/// Writes `bytes` to `path` so that a crash or power loss leaves the old file
/// or the new one, never half of one: written to a hidden file beside it,
/// flushed to disk, then renamed over it. `_writes` shows `writes.lock` is
/// held, so no other write lands in between.
pub fn write_atomically(
    _writes: &crate::locks::VaultWrites,
    path: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    use std::io::Write;

    replace_atomically(path, NewFile::Default, |file| file.write_all(bytes))
}

/// A file written and flushed to disk under a hidden name in the folder it
/// will go in, waiting for [`StagedFile::put`]. Writing it needs no lock, so
/// copying a big file in doesn't hold up saves. Removed if it's never put.
pub struct StagedFile {
    temp: PathBuf,
    put: bool,
}

/// Writes a [`StagedFile`] in `folder` with what `fill` writes.
pub fn stage_file(
    folder: &Path,
    fill: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> Result<StagedFile, String> {
    static STAGED: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let staged = StagedFile {
        temp: folder.join(format!(
            ".{}-{}-{}.netherstone-tmp",
            std::process::id(),
            nanos,
            STAGED.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        )),
        put: false,
    };
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staged.temp)
        .and_then(|mut file| {
            fill(&mut file)?;
            file.sync_all()
        })
        .map_err(|e| format!("Failed to write {}: {}", staged.temp.display(), e))?;
    Ok(staged)
}

impl StagedFile {
    /// Moves the file to `path`, in the same folder, replacing what's there.
    /// `_writes` shows `writes.lock` is held.
    pub fn put(mut self, _writes: &crate::locks::VaultWrites, path: &Path) -> Result<(), String> {
        std::fs::rename(&self.temp, path)
            .map_err(|e| format!("Failed to save {}: {}", path.display(), e))?;
        self.put = true;
        sync_folder(path);
        Ok(())
    }
}

impl Drop for StagedFile {
    fn drop(&mut self) {
        if !self.put {
            let _ = std::fs::remove_file(&self.temp);
        }
    }
}

/// Who may read a file written where none was. A file that's replaced keeps
/// the permissions it had.
#[derive(Clone, Copy)]
pub(crate) enum NewFile {
    /// What the system gives any new file.
    Default,
    /// Only its owner, for files that can hold secrets. Unix-like systems
    /// only; on Windows a new file takes its folder's access.
    OwnerOnly,
}

pub(crate) fn replace_atomically(
    path: &Path,
    new_file: NewFile,
    fill: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>,
) -> Result<(), String> {
    let name = path
        .file_name()
        .ok_or_else(|| format!("Not a file: {}", path.display()))?;
    let temp = path.with_file_name(format!(".{}.netherstone-tmp", name.to_string_lossy()));
    let written = create_temp(&temp, path, new_file)
        .and_then(|mut file| {
            fill(&mut file)?;
            file.sync_all()
        })
        .and_then(|()| std::fs::rename(&temp, path));
    if let Err(error) = written {
        let _ = std::fs::remove_file(&temp);
        return Err(format!("Failed to save {}: {}", path.display(), error));
    }
    sync_folder(path);
    Ok(())
}

/// Creates the temporary file `temp` that will be renamed over `target`,
/// removing whatever is there first (left by a write cut short, or put
/// there), so a write never goes through a link to somewhere else. It gets
/// `target`'s permissions, or `new_file`'s when there's no `target` yet, so
/// the rename never opens up a file only its owner could read.
pub(crate) fn create_temp(
    temp: &Path,
    target: &Path,
    new_file: NewFile,
) -> std::io::Result<std::fs::File> {
    match std::fs::remove_file(temp) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error),
        _ => {}
    }
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

        let kept = std::fs::metadata(target).ok().map(|meta| meta.permissions());
        // Created no wider than it will end up, so it's never readable by
        // more people than that, even for a moment.
        match (&kept, new_file) {
            (Some(kept), _) => options.mode(kept.mode()),
            (None, NewFile::OwnerOnly) => options.mode(0o600),
            (None, NewFile::Default) => &mut options,
        };
        let file = options.open(temp)?;
        // Creating takes away what the umask says; put it back.
        if let Some(kept) = kept {
            file.set_permissions(kept)?;
        }
        Ok(file)
    }
    #[cfg(not(unix))]
    {
        let _ = (target, new_file);
        options.open(temp)
    }
}

/// Like [`write_atomically`], creating the folders `path` needs first.
pub fn write_with_folders(
    writes: &crate::locks::VaultWrites,
    path: &Path,
    bytes: &[u8],
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    write_atomically(writes, path, bytes)
}

/// Flushes the rename itself to disk. Only Unix-like systems need it; a
/// failure leaves the file saved, if not yet durable.
fn sync_folder(path: &Path) {
    #[cfg(unix)]
    if let Some(parent) = path.parent() {
        let _ = std::fs::File::open(parent).and_then(|folder| folder.sync_all());
    }
    #[cfg(not(unix))]
    let _ = path;
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
    scan(dir, false)
}

/// [`scan_dir`] without the folders of other vaults inside `dir`, which keep
/// their own shards: what belongs to the vault at `dir`.
pub fn scan_own_dir(dir: &Path) -> Vec<FileNode> {
    scan(dir, true)
}

fn scan(dir: &Path, own_only: bool) -> Vec<FileNode> {
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

        if !is_scanned_name(&name) {
            continue;
        }

        let path = entry.path();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };

        if file_type.is_dir() {
            if own_only && crate::sync::state::has_vault_marker(&path) {
                continue;
            }
            let children = scan(&path, own_only);
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

/// Adds the shards in `node` and below to `paths`. Drawings appear in the
/// tree but are not indexed as Markdown.
pub fn collect_file_paths(node: &FileNode, paths: &mut Vec<String>) {
    match node.kind {
        FileNodeKind::File => {
            if is_markdown_path(Path::new(&node.path)) {
                paths.push(node.path.clone());
            }
        }
        FileNodeKind::Directory => {
            if let Some(children) = &node.children {
                for child in children {
                    collect_file_paths(child, paths);
                }
            }
        }
    }
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

    #[cfg(unix)]
    #[test]
    fn saves_never_write_through_a_left_temp_link() {
        let dir = temp_vault("temp-link");
        let outside = dir.with_file_name(format!("{}-outside", dir.file_name().unwrap().to_string_lossy()));
        std::fs::write(&outside, "keep").unwrap();
        std::fs::write(dir.join("Note.md"), "old").unwrap();
        std::os::unix::fs::symlink(&outside, dir.join(".Note.md.netherstone-tmp")).unwrap();

        let writes = crate::locks::vault_writes().unwrap();
        write_atomically(&writes, &dir.join("Note.md"), b"new").unwrap();

        assert_eq!(std::fs::read_to_string(&outside).unwrap(), "keep");
        assert_eq!(std::fs::read_to_string(dir.join("Note.md")).unwrap(), "new");
        assert!(!dir.join("Note.md").is_symlink());
        std::fs::remove_file(outside).unwrap();
    }

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

    #[test]
    fn a_staged_file_is_put_in_place_or_removed() {
        use std::io::Write;
        let vault = temp_vault("staged");
        let photo = vault.join("Photo.png");
        std::fs::write(&photo, "").unwrap();

        // Written without the lock, which is only taken to put it in place.
        let staged = stage_file(&vault, |file| file.write_all(b"picture")).unwrap();
        let unused = stage_file(&vault, |file| file.write_all(b"other")).unwrap();
        assert_eq!(std::fs::read_dir(&vault).unwrap().count(), 3);
        staged.put(&crate::locks::vault_writes().unwrap(), &photo).unwrap();
        drop(unused);

        let names: Vec<_> = std::fs::read_dir(&vault)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["Photo.png"]);
        assert_eq!(std::fs::read(&photo).unwrap(), b"picture");
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn write_atomically_replaces_the_file_and_leaves_nothing_behind() {
        let vault = temp_vault("atomic");
        let note = vault.join("Note.md");
        std::fs::write(&note, "old").unwrap();

        let writes = crate::locks::vault_writes().unwrap();
        write_atomically(&writes, &note, b"new").unwrap();
        write_with_folders(&writes, &vault.join("Deep/Folder/Other.md"), b"other").unwrap();
        drop(writes);

        let mut names: Vec<_> = std::fs::read_dir(&vault)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        assert_eq!(std::fs::read_to_string(&note).unwrap(), "new");
        assert_eq!(
            std::fs::read_to_string(vault.join("Deep/Folder/Other.md")).unwrap(),
            "other"
        );
        assert_eq!(names, ["Deep", "Note.md"]);
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn replacing_a_file_keeps_its_permissions() {
        use std::io::Write;
        use std::os::unix::fs::PermissionsExt;

        let vault = temp_vault("permissions");
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        let private = vault.join("Private.md");
        let shared = vault.join("Shared.md");
        std::fs::write(&private, "old").unwrap();
        std::fs::write(&shared, "old").unwrap();
        std::fs::set_permissions(&private, std::fs::Permissions::from_mode(0o600)).unwrap();
        // Wider than a usual umask lets a new file be.
        std::fs::set_permissions(&shared, std::fs::Permissions::from_mode(0o666)).unwrap();

        let writes = crate::locks::vault_writes().unwrap();
        write_atomically(&writes, &private, b"new").unwrap();
        write_atomically(&writes, &shared, b"new").unwrap();
        drop(writes);
        let secret = vault.join("secret.json");
        replace_atomically(&secret, NewFile::OwnerOnly, |file| file.write_all(b"{}")).unwrap();

        assert_eq!(mode(&private), 0o600);
        assert_eq!(mode(&shared), 0o666);
        assert_eq!(mode(&secret), 0o600);
        std::fs::remove_dir_all(&vault).unwrap();
    }
}
