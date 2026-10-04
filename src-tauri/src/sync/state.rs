//! Per-vault sync records.
//!
//! A vault is identified by an id stored in a hidden marker file inside the
//! vault (`.netherstone/vault-id`), so moving the folder keeps its sync
//! binding. The record itself lives in AppData (`sync/<vault-id>/state.json`)
//! next to the vault's Git directory, because sync settings are not
//! rebuildable the way the SQLite index is.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Hidden folder inside the vault for Netherstone's own metadata. Never synced.
pub const VAULT_META_DIR: &str = ".netherstone";
const VAULT_ID_FILE: &str = "vault-id";
const STATE_FILE: &str = "state.json";
const GIT_DIR: &str = "git";
pub const DEFAULT_BRANCH: &str = "main";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VaultSyncRecord {
    pub vault_id: String,
    pub vault_path: String,
    /// New vaults start with sync off; turning it on is an explicit user step.
    pub sync_enabled: bool,
    pub remote_url: Option<String>,
    pub repo_name: Option<String>,
    pub branch: String,
    pub last_commit: Option<String>,
    pub last_commit_at: Option<i64>,
    pub last_sync_at: Option<i64>,
    /// Files that changed both here and on GitHub, waiting for the user to
    /// choose a version. The vault holds this device's version meanwhile.
    #[serde(default)]
    pub conflicts: Vec<SyncConflict>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    /// Vault-relative path with `/` separators.
    pub path: String,
    /// Blob id of the GitHub version, kept in the sync repository's history.
    pub theirs: String,
    pub detected_at: i64,
}

impl VaultSyncRecord {
    fn new(vault_id: String, vault_path: &Path) -> Self {
        Self {
            vault_id,
            vault_path: vault_path.to_string_lossy().to_string(),
            sync_enabled: false,
            remote_url: None,
            repo_name: None,
            branch: DEFAULT_BRANCH.to_string(),
            last_commit: None,
            last_commit_at: None,
            last_sync_at: None,
            conflicts: Vec::new(),
        }
    }
}

pub fn vault_dir(sync_root: &Path, vault_id: &str) -> PathBuf {
    sync_root.join(vault_id)
}

pub fn git_dir(sync_root: &Path, vault_id: &str) -> PathBuf {
    vault_dir(sync_root, vault_id).join(GIT_DIR)
}

fn state_path(sync_root: &Path, vault_id: &str) -> PathBuf {
    vault_dir(sync_root, vault_id).join(STATE_FILE)
}

fn vault_id_path(vault_path: &Path) -> PathBuf {
    vault_path.join(VAULT_META_DIR).join(VAULT_ID_FILE)
}

fn is_valid_vault_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn generate_vault_id(vault_path: &Path) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let seed = format!("{}:{}:{}", vault_path.display(), nanos, std::process::id());
    blake3::hash(seed.as_bytes()).to_hex()[..20].to_string()
}

fn read_vault_id(vault_path: &Path) -> Option<String> {
    let id = std::fs::read_to_string(vault_id_path(vault_path)).ok()?;
    let id = id.trim();
    is_valid_vault_id(id).then(|| id.to_string())
}

fn write_vault_id(vault_path: &Path, vault_id: &str) -> Result<(), String> {
    let path = vault_id_path(vault_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    std::fs::write(&path, format!("{}\n", vault_id))
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn read_record(sync_root: &Path, vault_id: &str) -> Result<Option<VaultSyncRecord>, String> {
    let path = state_path(sync_root, vault_id);
    match std::fs::read_to_string(&path) {
        Ok(json) => serde_json::from_str(&json)
            .map(Some)
            .map_err(|e| format!("Failed to read sync state {}: {}", path.display(), e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!(
            "Failed to read sync state {}: {}",
            path.display(),
            e
        )),
    }
}

pub fn save_record(sync_root: &Path, record: &VaultSyncRecord) -> Result<(), String> {
    let dir = vault_dir(sync_root, &record.vault_id);
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create {}: {}", dir.display(), e))?;

    let json = serde_json::to_string_pretty(record)
        .map_err(|e| format!("Failed to serialize sync state: {}", e))?;

    // Write then rename so a crash never leaves a half-written record.
    let path = state_path(sync_root, &record.vault_id);
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, json)
        .map_err(|e| format!("Failed to write {}: {}", temp.display(), e))?;
    std::fs::rename(&temp, &path).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// The vault's sync record if it has one, without creating anything. A vault
/// that was never set up for sync (or is a copy of one) returns `None`.
pub fn find_record(sync_root: &Path, vault_path: &Path) -> Result<Option<VaultSyncRecord>, String> {
    let Some(vault_id) = read_vault_id(vault_path) else {
        return Ok(None);
    };
    Ok(read_record(sync_root, &vault_id)?.filter(|record| {
        same_path(Path::new(&record.vault_path), vault_path) || {
            // Moved, not copied: the old location no longer has this id.
            read_vault_id(Path::new(&record.vault_path)).as_deref() != Some(vault_id.as_str())
        }
    }))
}

/// Returns the sync record for `vault_path`, creating the vault id and record
/// on first use.
///
/// When the vault's id points at a record for a different folder that still
/// exists with the same id, the vault was copied rather than moved, so the copy
/// gets a fresh id and its own (disabled) record instead of sharing the
/// original's repository.
pub fn load_or_create_record(
    sync_root: &Path,
    vault_path: &Path,
) -> Result<VaultSyncRecord, String> {
    if let Some(vault_id) = read_vault_id(vault_path) {
        match read_record(sync_root, &vault_id)? {
            Some(mut record) => {
                let recorded_path = PathBuf::from(&record.vault_path);
                if same_path(&recorded_path, vault_path) {
                    return Ok(record);
                }

                let copied = read_vault_id(&recorded_path).as_deref() == Some(vault_id.as_str());
                if !copied {
                    record.vault_path = vault_path.to_string_lossy().to_string();
                    save_record(sync_root, &record)?;
                    return Ok(record);
                }
            }
            None => {
                let record = VaultSyncRecord::new(vault_id, vault_path);
                save_record(sync_root, &record)?;
                return Ok(record);
            }
        }
    }

    let vault_id = generate_vault_id(vault_path);
    write_vault_id(vault_path, &vault_id)?;
    let record = VaultSyncRecord::new(vault_id, vault_path);
    save_record(sync_root, &record)?;
    Ok(record)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::fs;

    pub fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netherstone-sync-{}-{}-{}",
            name,
            std::process::id(),
            generate_vault_id(Path::new(name))
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn creates_a_disabled_record_and_reuses_it() {
        let dir = temp_dir("record");
        let vault = dir.join("vault");
        fs::create_dir_all(&vault).unwrap();

        let record = load_or_create_record(&dir.join("sync"), &vault).unwrap();
        assert!(!record.sync_enabled);
        assert_eq!(record.branch, "main");
        assert_eq!(
            read_vault_id(&vault).as_deref(),
            Some(record.vault_id.as_str())
        );

        let again = load_or_create_record(&dir.join("sync"), &vault).unwrap();
        assert_eq!(again, record);
    }

    #[test]
    fn finding_a_record_never_creates_one() {
        let dir = temp_dir("find");
        let sync_root = dir.join("sync");
        let vault = dir.join("vault");
        fs::create_dir_all(&vault).unwrap();

        assert_eq!(find_record(&sync_root, &vault).unwrap(), None);
        assert!(!vault.join(VAULT_META_DIR).exists());

        let record = load_or_create_record(&sync_root, &vault).unwrap();
        assert_eq!(find_record(&sync_root, &vault).unwrap(), Some(record));
    }

    #[test]
    fn a_moved_vault_keeps_its_record() {
        let dir = temp_dir("moved");
        let sync_root = dir.join("sync");
        let vault = dir.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let mut record = load_or_create_record(&sync_root, &vault).unwrap();
        record.sync_enabled = true;
        save_record(&sync_root, &record).unwrap();

        let moved = dir.join("moved-vault");
        fs::rename(&vault, &moved).unwrap();
        assert!(find_record(&sync_root, &moved).unwrap().is_some());

        let after = load_or_create_record(&sync_root, &moved).unwrap();
        assert_eq!(after.vault_id, record.vault_id);
        assert!(after.sync_enabled);
        assert_eq!(after.vault_path, moved.to_string_lossy());
    }

    #[test]
    fn a_copied_vault_gets_its_own_record() {
        let dir = temp_dir("copied");
        let sync_root = dir.join("sync");
        let vault = dir.join("vault");
        fs::create_dir_all(&vault).unwrap();
        let mut original = load_or_create_record(&sync_root, &vault).unwrap();
        original.sync_enabled = true;
        save_record(&sync_root, &original).unwrap();

        let copy = dir.join("copy");
        fs::create_dir_all(copy.join(VAULT_META_DIR)).unwrap();
        fs::copy(vault_id_path(&vault), vault_id_path(&copy)).unwrap();

        assert_eq!(find_record(&sync_root, &copy).unwrap(), None);
        let copied = load_or_create_record(&sync_root, &copy).unwrap();
        assert_ne!(copied.vault_id, original.vault_id);
        assert!(!copied.sync_enabled);

        let original_again = load_or_create_record(&sync_root, &vault).unwrap();
        assert_eq!(original_again, original);
    }
}
