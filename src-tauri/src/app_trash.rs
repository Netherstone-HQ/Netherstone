//! Deleting files: the OS trash on desktop. Phones have none, so there a
//! deleted file moves to a trash folder in the app's data, where it can be
//! brought back.

#[cfg(desktop)]
pub use trash::{delete, delete_all};

#[cfg(any(mobile, test))]
use std::path::{Path, PathBuf};

#[cfg(mobile)]
pub fn delete(path: impl AsRef<Path>) -> Result<(), String> {
    move_to_trash(&trash_dir()?, path.as_ref(), &unique_name())
}

#[cfg(mobile)]
pub fn delete_all<T: AsRef<Path>>(paths: impl IntoIterator<Item = T>) -> Result<(), String> {
    let name = unique_name();
    let trash = trash_dir()?;
    paths
        .into_iter()
        .try_for_each(|path| move_to_trash(&trash, path.as_ref(), &name))
}

#[cfg(mobile)]
fn trash_dir() -> Result<PathBuf, String> {
    Ok(crate::db::app_data_dir()?.join("trash"))
}

/// A folder name per delete, so two deletes of files with the same name keep
/// both. Milliseconds since 1970, then a counter for deletes in the same one.
#[cfg(mobile)]
fn unique_name() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNT: AtomicU64 = AtomicU64::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis());
    format!("{millis}-{}", COUNT.fetch_add(1, Ordering::Relaxed))
}

/// Moves `path` into `trash/<batch>/`, keeping its name. A vault on another
/// storage volume than the app's data can't be renamed across, so it is
/// copied and then removed.
#[cfg(any(mobile, test))]
fn move_to_trash(trash: &Path, path: &Path, batch: &str) -> Result<(), String> {
    let name = path
        .file_name()
        .ok_or_else(|| format!("{} has no name to keep in the trash", path.display()))?;
    let folder = trash.join(batch);
    std::fs::create_dir_all(&folder)
        .map_err(|e| format!("Failed to create {}: {}", folder.display(), e))?;
    let to = folder.join(name);
    if to.exists() {
        return Err(format!("{} is already in the trash", to.display()));
    }
    if std::fs::rename(path, &to).is_ok() {
        return Ok(());
    }
    copy_all(path, &to).map_err(|e| format!("Failed to copy {}: {}", path.display(), e))?;
    let removed = if path.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    };
    removed.map_err(|e| format!("Failed to remove {}: {}", path.display(), e))
}

#[cfg(any(mobile, test))]
fn copy_all(from: &Path, to: &Path) -> std::io::Result<()> {
    if !from.is_dir() {
        return std::fs::copy(from, to).map(|_| ());
    }
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        copy_all(&entry.path(), &to.join(entry.file_name()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        crate::sync::state::tests::temp_dir(name)
    }

    #[test]
    fn a_deleted_folder_keeps_its_files_in_the_trash() {
        let root = temp("app-trash-folder");
        let folder = root.join("vault").join("Ideas");
        std::fs::create_dir_all(folder.join("Inner")).unwrap();
        std::fs::write(folder.join("Inner").join("one.md"), "# One").unwrap();
        let trash = root.join("trash");

        move_to_trash(&trash, &folder, "1").unwrap();

        assert!(!folder.exists());
        let kept = trash.join("1").join("Ideas").join("Inner").join("one.md");
        assert_eq!(std::fs::read_to_string(kept).unwrap(), "# One");
    }

    #[test]
    fn two_files_with_one_name_both_stay_in_the_trash() {
        let root = temp("app-trash-same-name");
        let trash = root.join("trash");
        for (batch, text) in [("1", "first"), ("2", "second")] {
            let dir = root.join(batch);
            std::fs::create_dir_all(&dir).unwrap();
            let file = dir.join("note.md");
            std::fs::write(&file, text).unwrap();
            move_to_trash(&trash, &file, batch).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(trash.join("1/note.md")).unwrap(),
            "first"
        );
        assert_eq!(
            std::fs::read_to_string(trash.join("2/note.md")).unwrap(),
            "second"
        );
    }

    #[test]
    fn copying_keeps_every_file_of_a_folder() {
        let root = temp("app-trash-copy");
        let from = root.join("from");
        std::fs::create_dir_all(from.join("a/b")).unwrap();
        std::fs::write(from.join("a/b/c.md"), "deep").unwrap();
        std::fs::write(from.join("top.md"), "top").unwrap();

        copy_all(&from, &root.join("to")).unwrap();

        assert_eq!(
            std::fs::read_to_string(root.join("to/a/b/c.md")).unwrap(),
            "deep"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("to/top.md")).unwrap(),
            "top"
        );
    }
}
