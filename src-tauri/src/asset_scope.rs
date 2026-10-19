//! The files the webview may load through the asset protocol (pictures,
//! sound and video shown in shards). Nothing is allowed at start; the vault
//! is added when it opens, and a picture, sound or video file outside it is
//! added when a shard shows it, however it got into the shard.

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

/// Lets the webview show the vault's files, including folders and files
/// linked into it from elsewhere (an attachment folder kept in a synced
/// folder, say), which the scope would otherwise judge by where they lead.
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
        let allowed = if target.is_dir() {
            scope.allow_directory(&target, true)
        } else {
            scope.allow_file(&target)
        };
        if let Err(error) = allowed {
            eprintln!(
                "[Netherstone] Couldn't allow linked vault files {}: {}",
                target.display(),
                error
            );
        }
    }
}

/// Where the links inside a vault lead. Links aren't followed further, so a
/// link back into the vault can't loop.
fn linked_targets(vault_path: &Path) -> Vec<PathBuf> {
    let mut targets = Vec::new();
    let mut pending = vec![vault_path.to_path_buf()];
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
                if let Ok(target) = path.canonicalize() {
                    if target.is_dir() || is_showable(&target) {
                        targets.push(target);
                    }
                }
            } else if file_type.is_dir() && entry.file_name() != ".git" {
                pending.push(path);
            }
        }
    }
    targets
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
    if is_showable(path) {
        let scope = app.asset_protocol_scope();
        if !scope.is_allowed(path) {
            if let Err(error) = scope.allow_file(path) {
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
    fn links_in_the_vault_are_followed_once() {
        let root = std::env::temp_dir().join(format!("netherstone-scope-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let vault = root.join("Vault");
        let synced = root.join("Synced");
        std::fs::create_dir_all(vault.join("Notes")).unwrap();
        std::fs::create_dir_all(&synced).unwrap();
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
        let mut expected = vec![canonical(synced.clone()), canonical(root.join("photo.png"))];
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
