//! Drawings: reading, saving, merging and their exported pictures.

use super::{CHANGED_ON_DISK, is_changed};
use crate::vault_access::{in_open_vault, open_vault_only};
use crate::{locks, sync, vault};
use std::path::Path;

fn ensure_drawing_path(path: &Path) -> Result<(), String> {
    if vault::is_drawing_path(path) {
        Ok(())
    } else {
        Err(format!("Not a drawing file: {}", path.display()))
    }
}

#[tauri::command(async)]
pub(crate) fn read_drawing_file(file_path: String) -> Result<String, String> {
    in_open_vault(&file_path)?;
    let path = Path::new(&file_path);
    ensure_drawing_path(path)?;

    std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read drawing {}: {}", file_path, e))
}

/// Saves a drawing. `expected_content` is the drawing as the app last read
/// or wrote it; if the file now holds something else, it changed outside the
/// app and the save is refused rather than write over it.
#[tauri::command(async)]
pub(crate) fn save_drawing_file(
    file_path: String,
    content: String,
    expected_content: Option<String>,
) -> Result<(), String> {
    in_open_vault(&file_path)?;
    write_drawing_file(Path::new(&file_path), &content, expected_content.as_deref())
}

/// Merges `ours` and `theirs`, two versions of the drawing `base`, shape by
/// shape. None when one of them isn't a drawing.
#[tauri::command(async)]
pub(crate) fn merge_drawings(
    base: String,
    ours: String,
    theirs: String,
) -> Option<sync::drawing_merge::MergedDrawing> {
    sync::drawing_merge::merge(&base, &ours, &theirs)
}

pub(crate) fn write_drawing_file(
    path: &Path,
    content: &str,
    expected: Option<&str>,
) -> Result<(), String> {
    ensure_drawing_path(path)?;

    let writes = locks::vault_writes()?;
    if is_changed(std::fs::read(path).ok().as_deref(), expected) {
        return Err(CHANGED_ON_DISK.to_string());
    }
    vault::write_atomically(&writes, path, content.as_bytes())
}

/// Returns the shards in `vault_path` whose text contains any of `needles`.
/// Used to find the notes that embed an exported drawing.
#[tauri::command(async)]
pub(crate) fn find_shards_containing(
    vault_path: String,
    needles: Vec<String>,
) -> Result<Vec<String>, String> {
    open_vault_only(&vault_path)?;
    Ok(shards_containing(Path::new(&vault_path), &needles))
}

fn shards_containing(vault: &Path, needles: &[String]) -> Vec<String> {
    let needles: Vec<&str> = needles
        .iter()
        .map(String::as_str)
        .filter(|n| !n.is_empty())
        .collect();
    let mut paths = Vec::new();
    for node in &vault::scan_dir(vault) {
        vault::collect_file_paths(node, &mut paths);
    }

    paths
        .into_iter()
        .filter(|path| {
            std::fs::read_to_string(path)
                .map(|content| needles.iter().any(|needle| content.contains(needle)))
                .unwrap_or(false)
        })
        .collect()
}

/// A drawing a shard shows, with the files its pictures point at: `None`
/// where a picture has no source or it isn't a file in the vault.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DrawingPictures {
    drawing_path: String,
    image_paths: Vec<Option<String>>,
}

/// Returns the drawings among `drawings` that have a picture missing or older
/// than the drawing, such as one changed while the app was closed. Drawings
/// that don't exist are left out.
#[tauri::command(async)]
pub(crate) fn stale_drawing_pictures(
    vault_path: String,
    drawings: Vec<DrawingPictures>,
) -> Result<Vec<String>, String> {
    open_vault_only(&vault_path)?;
    Ok(drawings
        .into_iter()
        .filter(|drawing| {
            let images: Vec<Option<&Path>> = drawing
                .image_paths
                .iter()
                .map(|path| {
                    path.as_deref()
                        .filter(|path| in_open_vault(path).is_ok())
                        .map(Path::new)
                })
                .collect();
            in_open_vault(&drawing.drawing_path).is_ok()
                && pictures_are_stale(Path::new(&drawing.drawing_path), &images)
        })
        .map(|drawing| drawing.drawing_path)
        .collect())
}

fn pictures_are_stale(drawing: &Path, images: &[Option<&Path>]) -> bool {
    fn modified(path: &Path) -> Option<std::time::SystemTime> {
        std::fs::metadata(path)
            .ok()
            .filter(|meta| meta.is_file())
            .and_then(|meta| meta.modified().ok())
    }

    let Some(drawn) = modified(drawing).filter(|_| vault::is_drawing_path(drawing)) else {
        return false;
    };
    images.iter().any(|image| {
        image
            .and_then(modified)
            .is_none_or(|exported| exported < drawn)
    })
}

/// Creates an empty drawing named `name` in `directory` and returns its path.
#[tauri::command(async)]
pub(crate) fn create_drawing_file(directory: String, name: String) -> Result<String, String> {
    in_open_vault(&directory)?;
    let dir = Path::new(&directory);

    if !dir.is_dir() {
        return Err(format!("Not a directory: {}", directory));
    }

    let writes = locks::vault_writes()?;
    let path = vault::unique_drawing_path(dir, &name)?;
    vault::write_atomically(&writes, &path, vault::EMPTY_DRAWING.as_bytes())?;

    Ok(path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drawing_save_refuses_to_write_over_an_outside_change() {
        let dir = std::env::temp_dir().join(format!("netherstone-drawing-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let drawing = dir.join("Plan.excalidraw");
        std::fs::write(&drawing, "opened").unwrap();

        write_drawing_file(&drawing, "drawn", Some("opened")).unwrap();
        std::fs::write(&drawing, "outside").unwrap();
        assert_eq!(
            write_drawing_file(&drawing, "drawn more", Some("drawn")),
            Err(CHANGED_ON_DISK.to_string())
        );
        assert_eq!(std::fs::read_to_string(&drawing).unwrap(), "outside");

        write_drawing_file(&drawing, "merged", Some("outside")).unwrap();
        assert_eq!(std::fs::read_to_string(&drawing).unwrap(), "merged");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn pictures_are_stale_when_missing_or_older_than_the_drawing() {
        let dir = std::env::temp_dir().join(format!("netherstone-stale-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let at = |name: &str, seconds: u64| {
            let path = dir.join(name);
            std::fs::write(&path, name).unwrap();
            std::fs::File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(seconds))
                .unwrap();
            path
        };
        let drawing = at("Plan.excalidraw", 20);
        let older = at("old.png", 10);
        let same = at("same.png", 20);
        let newer = at("new.png", 30);
        let missing = dir.join("missing.png");
        let not_a_drawing = at("Plan.md", 20);

        let stale = |images: &[Option<&Path>]| pictures_are_stale(&drawing, images);
        assert!(!stale(&[Some(&same), Some(&newer)]));
        assert!(stale(&[Some(&newer), Some(&older)]));
        assert!(stale(&[Some(&newer), Some(&missing)]));
        assert!(stale(&[Some(&newer), None]));
        assert!(!pictures_are_stale(&dir.join("Gone.excalidraw"), &[None]));
        assert!(!pictures_are_stale(&not_a_drawing, &[None]));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn find_shards_containing_matches_any_needle_in_markdown_only() {
        let dir = std::env::temp_dir().join(format!("netherstone-find-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(
            dir.join("a.md"),
            r#"<img data-excalidraw="d/F &amp; co.excalidraw" />"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("sub/b.md"),
            r#"<img data-excalidraw="d/F & co.excalidraw" />"#,
        )
        .unwrap();
        std::fs::write(dir.join("c.md"), "no drawings").unwrap();
        std::fs::write(dir.join("d.excalidraw"), r#"data-excalidraw="d/F & co"#).unwrap();

        let needles = vec![
            r#"data-excalidraw="d/F & co"#.to_string(),
            r#"data-excalidraw="d/F &amp; co"#.to_string(),
            String::new(),
        ];
        let mut found = shards_containing(&dir, &needles);
        found.sort();
        std::fs::remove_dir_all(&dir).unwrap();

        let names: Vec<_> = found
            .iter()
            .map(|path| {
                Path::new(path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, ["a.md", "b.md"]);
    }
}
