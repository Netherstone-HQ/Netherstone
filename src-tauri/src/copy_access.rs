//! Which files may be copied into the vault's attachments, so a script that
//! got into the page can't copy a private file in and read it from there.
//!
//! A file may be copied when it is inside the open vault, when it is a
//! picture, sound or video file (shards can show those from anywhere
//! already), or when the user picked it in the media dialog or said yes to
//! copying it in a native dialog this session.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::asset_scope::is_showable;
use crate::vault_access::{OpenVault, is_same};

pub struct CopySources {
    allowed: Mutex<Vec<PathBuf>>,
}

static COPY_SOURCES: CopySources = CopySources::new();

pub fn get() -> &'static CopySources {
    &COPY_SOURCES
}

impl CopySources {
    const fn new() -> Self {
        Self {
            allowed: Mutex::new(Vec::new()),
        }
    }

    /// Notes files the user picked or agreed to copy in a native dialog.
    pub fn allow(&self, paths: &[PathBuf]) {
        lock(&self.allowed).extend_from_slice(paths);
    }

    /// Checks that `path` may be copied into the open vault.
    pub fn check(&self, vaults: &OpenVault, path: &Path) -> Result<(), String> {
        if self.needs_asking(vaults, path) {
            Err(format!("{} wasn't picked to copy into the vault", path.display()))
        } else {
            Ok(())
        }
    }

    /// True when copying `path` needs the user to say yes first.
    pub fn needs_asking(&self, vaults: &OpenVault, path: &Path) -> bool {
        let fine = vaults.check_path(path).is_ok()
            || is_showable(path)
            || lock(&self.allowed).iter().any(|allowed| is_same(allowed, path));
        !fine
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// The question for copying `paths` in, naming the first few files.
pub fn question(paths: &[PathBuf]) -> String {
    const SHOWN: usize = 5;
    let mut lines: Vec<String> = paths
        .iter()
        .take(SHOWN)
        .map(|path| path.display().to_string())
        .collect();
    if paths.len() > SHOWN {
        lines.push(format!("and {} more", paths.len() - SHOWN));
    }
    let count = if paths.len() == 1 {
        "this file".to_string()
    } else {
        format!("these {} files", paths.len())
    };
    format!("Copy {count} from outside the vault into its attachments?\n\n{}", lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    #[test]
    fn only_vault_files_media_and_picked_files_can_be_copied() {
        let dir = temp_dir("copy-sources");
        let vault = dir.join("Vault");
        std::fs::create_dir_all(&vault).unwrap();
        let vaults = OpenVault::new();
        vaults.allow(&vault);
        vaults.open(&dir.join("sync"), &vault).unwrap();
        let sources = CopySources::new();
        let check = |path: PathBuf| sources.check(&vaults, &path);

        assert!(check(vault.join("docs/report.pdf")).is_ok());
        assert!(check(dir.join("photo.png")).is_ok());
        assert!(check(dir.join("clip.webm")).is_ok());
        for name in ["id_rsa", ".env", "report.pdf", "config.json"] {
            assert!(check(dir.join(name)).is_err(), "{name}");
        }
        assert!(check(vault.join("../id_rsa")).is_err());

        sources.allow(&[dir.join("report.pdf")]);
        assert!(check(dir.join("report.pdf")).is_ok());
        assert!(check(dir.join("id_rsa")).is_err());
        assert!(check(dir.join("x/../report.pdf")).is_err());
    }

    #[test]
    fn the_question_names_the_first_files() {
        let one = question(&[PathBuf::from("/a/report.pdf")]);
        assert!(one.starts_with("Copy this file from outside the vault"));
        assert!(one.ends_with("/a/report.pdf"));

        let many: Vec<PathBuf> = (0..7).map(|i| PathBuf::from(format!("/a/{i}.pdf"))).collect();
        let text = question(&many);
        assert!(text.starts_with("Copy these 7 files"));
        assert!(text.contains("/a/4.pdf"));
        assert!(!text.contains("/a/5.pdf"));
        assert!(text.ends_with("and 2 more"));
    }
}
