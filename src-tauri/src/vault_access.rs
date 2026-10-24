//! Which vault is open. Commands that touch files only accept paths inside it,
//! so a script that got into the page can't reach the rest of the computer.
//!
//! A folder can become the open vault when it is a vault already (it has the
//! marker Netherstone writes into every vault it opens) or the user just
//! picked or created it in a native dialog this session.

use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub struct OpenVault {
    open: Mutex<Option<PathBuf>>,
    picked: Mutex<Vec<PathBuf>>,
}

static OPEN_VAULT: OpenVault = OpenVault::new();

pub fn get() -> &'static OpenVault {
    &OPEN_VAULT
}

impl OpenVault {
    const fn new() -> Self {
        Self {
            open: Mutex::new(None),
            picked: Mutex::new(Vec::new()),
        }
    }

    /// Notes a folder the user picked or created in a native dialog.
    pub fn allow(&self, folder: &Path) {
        lock(&self.picked).push(folder.to_path_buf());
    }

    /// Makes `vault_path` the open vault and marks it as a vault, so it opens
    /// again next time.
    pub fn open(&self, sync_root: &Path, vault_path: &Path) -> Result<(), String> {
        if !vault_path.is_dir() {
            return Err(format!("Vault folder not found: {}", vault_path.display()));
        }
        let picked = lock(&self.picked)
            .iter()
            .any(|folder| is_same(folder, vault_path));
        if !picked && !crate::sync::state::has_vault_marker(vault_path) {
            return Err(format!(
                "{} isn't a vault yet. Open it from the folder picker.",
                vault_path.display()
            ));
        }
        crate::sync::state::load_or_create_record(sync_root, vault_path)?;
        *lock(&self.open) = Some(vault_path.to_path_buf());
        Ok(())
    }

    /// Checks that `vault_path` is the open vault.
    pub fn check_vault(&self, vault_path: &Path) -> Result<(), String> {
        match &*lock(&self.open) {
            Some(open) if is_same(open, vault_path) => Ok(()),
            _ => Err(format!("{} isn't the open vault", vault_path.display())),
        }
    }

    /// Checks that `vault_path` is the open vault or another of the user's
    /// vaults.
    pub fn check_known_vault(&self, vault_path: &Path) -> Result<(), String> {
        if self.check_vault(vault_path).is_ok()
            || crate::sync::state::has_vault_marker(vault_path)
        {
            Ok(())
        } else {
            Err(format!("{} isn't a vault", vault_path.display()))
        }
    }

    /// Checks that `path` is the open vault or inside it.
    pub fn check_path(&self, path: &Path) -> Result<(), String> {
        match &*lock(&self.open) {
            Some(open) if is_within(open, path) => Ok(()),
            _ => Err(format!("{} is outside the open vault", path.display())),
        }
    }

    /// Checks that `path` is inside the open vault, not the vault itself.
    pub fn check_inside(&self, path: &Path) -> Result<(), String> {
        self.check_path(path)?;
        if self.check_vault(path).is_ok() {
            return Err(format!("{} is the vault itself", path.display()));
        }
        Ok(())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// One part of a path, compared the way the file system does: ignoring case
/// on Windows and macOS.
fn part(component: Component<'_>) -> String {
    let part = component.as_os_str().to_string_lossy();
    if cfg!(any(windows, target_os = "macos")) {
        part.to_lowercase()
    } else {
        part.into_owned()
    }
}

fn is_same(a: &Path, b: &Path) -> bool {
    is_within(a, b) && is_within(b, a)
}

/// True when `path` is `folder` or inside it. A path with `..` in it never is.
fn is_within(folder: &Path, path: &Path) -> bool {
    if path.components().any(|c| c == Component::ParentDir) {
        return false;
    }
    let parts = |p: &Path| -> Vec<String> {
        p.components()
            .filter(|c| *c != Component::CurDir)
            .map(part)
            .collect()
    };
    let (folder, path) = (parts(folder), parts(path));
    !folder.is_empty() && path.starts_with(&folder)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    #[test]
    fn paths_must_stay_inside_the_open_vault() {
        let dir = temp_dir("open-vault");
        let vault = dir.join("Vault");
        std::fs::create_dir_all(&vault).unwrap();
        let vaults = OpenVault::new();
        assert!(vaults.check_path(&vault.join("Note.md")).is_err());

        vaults.allow(&vault);
        vaults.open(&dir.join("sync"), &vault).unwrap();

        assert!(vaults.check_vault(&vault).is_ok());
        assert!(vaults.check_vault(&vault.join(".")).is_ok());
        assert!(vaults.check_path(&vault).is_ok());
        assert!(vaults.check_inside(&vault).is_err());
        assert!(vaults.check_inside(&vault.join("Notes/Note.md")).is_ok());
        assert!(vaults.check_path(&vault.join("../secret.txt")).is_err());
        assert!(vaults.check_path(&vault.join("Notes/../../secret.txt")).is_err());
        assert!(vaults.check_path(&dir.join("Vault2/Note.md")).is_err());
        assert!(vaults.check_path(&dir.join("secret.txt")).is_err());
        assert!(vaults.check_vault(&dir).is_err());
    }

    #[test]
    fn only_vaults_and_picked_folders_open() {
        let dir = temp_dir("open-vault-allowed");
        let sync_root = dir.join("sync");
        let (picked, other) = (dir.join("Picked"), dir.join("Other"));
        std::fs::create_dir_all(&picked).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        let vaults = OpenVault::new();

        assert!(vaults.open(&sync_root, &other).is_err());
        assert!(vaults.check_path(&other.join("Note.md")).is_err());

        vaults.allow(&picked);
        vaults.open(&sync_root, &picked).unwrap();
        assert!(vaults.check_path(&picked.join("Note.md")).is_ok());

        // Opening marked it, so it opens again in a later session.
        let later = OpenVault::new();
        later.open(&sync_root, &picked).unwrap();
        assert!(later.check_path(&picked.join("Note.md")).is_ok());
    }
}
