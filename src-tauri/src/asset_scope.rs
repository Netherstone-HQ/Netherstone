//! The files the webview may load through the asset protocol (pictures,
//! sound and video shown in shards). Nothing is allowed at start; the vault
//! is added when it opens, and a picture, sound or video file outside it is
//! added when a shard shows it, however it got into the shard. The Gallery's
//! thumbnails are added as they're made.

use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

use crate::db::attachments::extension_for_path;

/// Files a shard can show from outside the vault. Anything else (documents,
/// keys, settings) is never served, even when a shard links to it.
const SHOWABLE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "tif", "tiff", "mp3", "wav",
    "ogg", "oga", "m4a", "flac", "aac", "opus", "wma", "mp4", "mov", "mkv", "avi", "webm", "m4v",
    "wmv", "flv", "ogv",
];

/// Lets the webview show the vault's files, and the pictures, sound and
/// video in folders and files linked into it from elsewhere (an attachment
/// folder kept in a synced folder, say), which the scope would otherwise
/// judge by where they lead. Other files behind a link aren't served.
pub fn allow_vault<R: Runtime>(app: &AppHandle<R>, vault_path: &Path) {
    let scope = app.asset_protocol_scope();
    if let Err(error) = scope.allow_directory(vault_path, true) {
        eprintln!(
            "[Netherstone] Couldn't allow vault files {}: {}",
            vault_path.display(),
            error
        );
    }
    for target in linked_targets(vault_path) {
        if let Err(error) = scope.allow_file(&target) {
            eprintln!(
                "[Netherstone] Couldn't allow linked vault files {}: {}",
                target.display(),
                error
            );
        }
    }
}

/// Lets the webview show a Gallery thumbnail the app made.
pub fn allow_thumbnail<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    if let Err(error) = app.asset_protocol_scope().allow_file(path) {
        eprintln!(
            "[Netherstone] Couldn't allow the thumbnail {}: {}",
            path.display(),
            error
        );
    }
}

/// The picture, sound and video files the links inside a vault lead to:
/// linked files, and the files in linked folders. Links aren't followed
/// further, so a link back into the vault can't loop.
fn linked_targets(vault_path: &Path) -> Vec<PathBuf> {
    let mut targets = Vec::new();
    let mut linked_folders = Vec::new();
    walk(vault_path, &mut |link| {
        if let Ok(target) = link.canonicalize() {
            if target.is_dir() {
                linked_folders.push(target);
            } else if is_showable(&target) {
                targets.push(target);
            }
        }
    }, &mut |_| {});
    for folder in linked_folders {
        walk(&folder, &mut |_| {}, &mut |file| {
            if is_showable(file) {
                targets.push(file.to_path_buf());
            }
        });
    }
    targets
}

/// Goes through the folders under `dir`, without following links, calling
/// `on_link` with each link and `on_file` with each file.
fn walk(dir: &Path, on_link: &mut dyn FnMut(&Path), on_file: &mut dyn FnMut(&Path)) {
    let mut pending = vec![dir.to_path_buf()];
    while let Some(dir) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if file_type.is_symlink() {
                on_link(&path);
            } else if file_type.is_dir() {
                if entry.file_name() != ".git" {
                    pending.push(path);
                }
            } else {
                on_file(&path);
            }
        }
    }
}

pub fn is_showable(path: &Path) -> bool {
    SHOWABLE_EXTENSIONS.contains(&extension_for_path(path).as_str())
}

/// Lets the webview show `path` if it is a picture, sound or video file.
/// Returns whether the file is there.
pub fn show_linked_file<R: Runtime>(app: &AppHandle<R>, path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    // The scope judges a file by where it leads, so that's what is allowed,
    // and only when that is a picture, sound or video file.
    let target = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    if is_showable(&target) {
        let scope = app.asset_protocol_scope();
        if !scope.is_allowed(&target) {
            if let Err(error) = scope.allow_file(&target) {
                eprintln!(
                    "[Netherstone] Couldn't allow linked file {}: {}",
                    path.display(),
                    error
                );
            }
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    #[test]
    fn only_media_behind_links_in_the_vault_is_served() {
        let root = std::env::temp_dir().join(format!("netherstone-scope-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let vault = root.join("Vault");
        let synced = root.join("Synced");
        std::fs::create_dir_all(vault.join("Notes")).unwrap();
        std::fs::create_dir_all(synced.join("Clips")).unwrap();
        std::fs::write(synced.join("pic.png"), b"p").unwrap();
        std::fs::write(synced.join("Clips/clip.mp4"), b"v").unwrap();
        std::fs::write(synced.join("id_rsa"), b"k").unwrap();
        std::fs::write(root.join("photo.png"), b"p").unwrap();
        std::fs::write(root.join("secret.txt"), b"s").unwrap();
        std::os::unix::fs::symlink(&synced, vault.join("_attachments")).unwrap();
        std::os::unix::fs::symlink(root.join("photo.png"), vault.join("Notes/photo.png")).unwrap();
        std::os::unix::fs::symlink(root.join("secret.txt"), vault.join("Notes/secret.txt"))
            .unwrap();
        std::os::unix::fs::symlink(&vault, synced.join("back")).unwrap();

        let mut targets = linked_targets(&vault);
        targets.sort();
        let canonical = |path: PathBuf| path.canonicalize().unwrap();
        let mut expected = vec![
            canonical(synced.join("pic.png")),
            canonical(synced.join("Clips/clip.mp4")),
            canonical(root.join("photo.png")),
        ];
        expected.sort();
        std::fs::remove_dir_all(&root).unwrap();
        assert_eq!(targets, expected);
    }

    #[test]
    fn only_pictures_sound_and_video_can_be_shown() {
        for name in ["a.png", "b.JPG", "c.mp3", "d.webm", "/x/y/photo.HEIC.jpeg"] {
            assert!(is_showable(Path::new(name)), "{name}");
        }
        for name in [
            "id_rsa",
            ".env",
            "notes.md",
            "a.pdf",
            "config.json",
            "run.exe",
        ] {
            assert!(!is_showable(Path::new(name)), "{name}");
        }
    }
}
