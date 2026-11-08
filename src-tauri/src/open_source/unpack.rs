//! Putting the downloads into the new vault: a template's zip unpacked as
//! it is, or a folder's drawings moved in beside the Markdown import.

use std::io::Read;
use std::path::{Path, PathBuf};

use super::{PathCheck, Refusal, check_path};

/// Moves the downloaded `drawings` (scratch-relative, `/`-separated and
/// checked) from `scratch` into the vault `folder`, at the same paths.
pub(super) fn move_drawings(
    scratch: &Path,
    folder: &Path,
    drawings: &[PathBuf],
) -> Result<(), Refusal> {
    let join = |root: &Path, path: &Path| {
        path.to_string_lossy()
            .split('/')
            .fold(root.to_path_buf(), |path, segment| path.join(segment))
    };
    for drawing in drawings {
        let (from, to) = (join(scratch, drawing), join(folder, drawing));
        if let Some(parent) = to.parent() {
            std::fs::create_dir_all(parent).map_err(|_| Refusal::DownloadFailed)?;
        }
        // The scratch folder can be on another disk, where a rename fails.
        if std::fs::rename(&from, &to).is_err() {
            std::fs::copy(&from, &to).map_err(|_| Refusal::DownloadFailed)?;
            std::fs::remove_file(&from).map_err(|_| Refusal::DownloadFailed)?;
        }
    }
    Ok(())
}

/// Unpacks a template's zip into the new vault: its shards, drawings and
/// pictures, as they are. Every entry is checked before anything is written.
/// When it fails part way, it takes back the files and folders it wrote and
/// leaves anything else, such as files put in the folder while it downloaded.
pub(super) fn unpack(zip: &Path, vault_folder: &Path) -> Result<(), Refusal> {
    let mut written = Vec::new();
    let unpacked = unpack_into(zip, vault_folder, &mut written);
    if unpacked.is_err() {
        // Newest first, so a folder's files go before it; a folder goes
        // only when nothing else was put in it.
        for path in written.iter().rev() {
            let _ = match path {
                Written::File(path) => std::fs::remove_file(path),
                Written::Folder(path) => std::fs::remove_dir(path),
            };
        }
    }
    unpacked
}

/// A file or folder `unpack` made.
enum Written {
    File(PathBuf),
    Folder(PathBuf),
}

fn unpack_into(zip: &Path, vault_folder: &Path, written: &mut Vec<Written>) -> Result<(), Refusal> {
    fn failed<E>(_: E) -> Refusal {
        Refusal::DownloadFailed
    }
    let mut archive =
        zip::ZipArchive::new(std::fs::File::open(zip).map_err(failed)?).map_err(failed)?;
    let mut keep = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(failed)?;
        if entry.is_dir() {
            continue;
        }
        if entry.is_symlink() {
            return Err(Refusal::DownloadFailed);
        }
        match check_path(entry.name()) {
            PathCheck::Keep(_) => keep.push((index, entry.name().to_string(), entry.size())),
            PathCheck::LeaveOut => {}
            PathCheck::Refuse => return Err(Refusal::DownloadFailed),
        }
    }
    for (index, name, size) in keep {
        let target = name
            .split('/')
            .fold(vault_folder.to_path_buf(), |path, segment| {
                path.join(segment)
            });
        if let Some(parent) = target.parent() {
            create_folders(parent, vault_folder, written).map_err(failed)?;
        }
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
            .map_err(failed)?;
        written.push(Written::File(target));
        let entry = archive.by_index(index).map_err(failed)?;
        let copied = std::io::copy(&mut entry.take(size + 1), &mut file).map_err(failed)?;
        if copied != size {
            return Err(Refusal::DownloadFailed);
        }
    }
    Ok(())
}

/// Makes `folder` and the folders above it, up to `vault_folder`, noting
/// the ones it made.
fn create_folders(
    folder: &Path,
    vault_folder: &Path,
    written: &mut Vec<Written>,
) -> std::io::Result<()> {
    if folder == vault_folder {
        return Ok(());
    }
    if let Some(parent) = folder.parent() {
        create_folders(parent, vault_folder, written)?;
    }
    match std::fs::create_dir(folder) {
        Ok(()) => written.push(Written::Folder(folder.to_path_buf())),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && folder.is_dir() => {}
        Err(error) => return Err(error),
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;
    use std::io::Write;

    fn zip_of(dir: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        let path = dir.join("template.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn unpacks_templates_as_they_are() {
        let dir = temp_dir("open-source-unpack");
        let zip = zip_of(
            &dir,
            &[
                ("Start here.md", b"# Start"),
                ("World/Places.md", b"@Start here"),
                ("_attachments/map.png", b"png"),
                (".netherstone/vault-id", b"old"),
                ("run.sh", b"echo"),
            ],
        );
        let vault_folder = dir.join("Worldbuilding");
        std::fs::create_dir(&vault_folder).unwrap();
        unpack(&zip, &vault_folder).unwrap();
        assert_eq!(
            std::fs::read_to_string(vault_folder.join("World").join("Places.md")).unwrap(),
            "@Start here"
        );
        assert!(vault_folder.join("_attachments").join("map.png").is_file());
        assert!(!vault_folder.join(".netherstone").exists());
        assert!(!vault_folder.join("run.sh").exists());

        let climbing = zip_of(
            &dir,
            &[("Start here.md", b"# Start"), ("../outside.md", b"x")],
        );
        let other = dir.join("Other");
        std::fs::create_dir(&other).unwrap();
        assert_eq!(unpack(&climbing, &other), Err(Refusal::DownloadFailed));
        assert!(!dir.join("outside.md").exists());
        assert!(!other.join("Start here.md").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_unpack_takes_back_only_what_it_wrote() {
        let dir = temp_dir("open-source-unpack-failed");
        let zip = zip_of(
            &dir,
            &[
                ("Start here.md", b"# Start"),
                ("World/Places.md", b"x"),
                ("Mine/Map.md", b"x"),
                ("Notes.md", b"x"),
            ],
        );
        let vault_folder = dir.join("Worldbuilding");
        // Put in the folder while the template downloaded.
        std::fs::create_dir_all(vault_folder.join("Mine")).unwrap();
        std::fs::write(vault_folder.join("Notes.md"), "mine").unwrap();

        assert_eq!(unpack(&zip, &vault_folder), Err(Refusal::DownloadFailed));
        assert_eq!(
            std::fs::read_to_string(vault_folder.join("Notes.md")).unwrap(),
            "mine"
        );
        assert!(vault_folder.join("Mine").is_dir());
        assert!(!vault_folder.join("Mine").join("Map.md").exists());
        assert!(!vault_folder.join("Start here.md").exists());
        assert!(!vault_folder.join("World").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn moves_drawings_into_the_vault_as_they_are() {
        let dir = temp_dir("open-source-drawings");
        let (scratch, vault_folder) = (dir.join("scratch"), dir.join("Field guide"));
        std::fs::create_dir_all(scratch.join("Field notes")).unwrap();
        std::fs::create_dir_all(&vault_folder).unwrap();
        std::fs::write(scratch.join("Field notes").join("Wings.excalidraw"), "{}").unwrap();
        std::fs::write(scratch.join("Birds.md"), "# Birds").unwrap();

        move_drawings(
            &scratch,
            &vault_folder,
            &[PathBuf::from("Field notes/Wings.excalidraw")],
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(vault_folder.join("Field notes").join("Wings.excalidraw"))
                .unwrap(),
            "{}"
        );
        assert!(
            !scratch
                .join("Field notes")
                .join("Wings.excalidraw")
                .exists()
        );
        // The rest stays for the Markdown import.
        assert!(scratch.join("Birds.md").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
