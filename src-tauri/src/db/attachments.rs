//! Attachment rows in the database: what links to each file, and counts.

use rusqlite::{Connection, params};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

/// How rows name their vault: the database is shared by every vault.
pub(crate) fn vault_key(vault_path: &Path) -> String {
    vault_path.to_string_lossy().into_owned()
}

/// How paths are spelled on a system: what separates their parts, and
/// whether names that differ only by case are one name.
#[derive(Clone, Copy)]
pub(crate) struct PathStyle {
    separators: &'static [char],
    ignores_case: bool,
}

impl PathStyle {
    pub(crate) const WINDOWS: Self = Self {
        separators: &['\\', '/'],
        ignores_case: true,
    };
    pub(crate) const UNIX: Self = Self {
        separators: &['/'],
        ignores_case: false,
    };
    pub(crate) const NATIVE: Self = if cfg!(windows) {
        Self::WINDOWS
    } else {
        Self::UNIX
    };

    fn parts(self, path: &str) -> impl Iterator<Item = &str> {
        path.split(self.separators)
            .filter(|part| !part.is_empty() && *part != ".")
    }

    fn same_name(self, a: &str, b: &str) -> bool {
        a == b || (self.ignores_case && a.to_lowercase() == b.to_lowercase())
    }
}

/// How reference rows name a shard: its path in the vault, with `/`.
/// Saves hand in the scan's spelling, the assistant's tools the vault joined
/// with a `/` path, so one form keeps each shard to one row. A path outside
/// the vault stays as it is.
pub(crate) fn shard_key(vault_path: &Path, file_path: &str) -> String {
    shard_key_in(PathStyle::NATIVE, &vault_key(vault_path), file_path)
}

pub(crate) fn shard_key_in(style: PathStyle, vault_path: &str, file_path: &str) -> String {
    let mut parts = style.parts(file_path);
    for root_part in style.parts(vault_path) {
        match parts.next() {
            Some(part) if style.same_name(part, root_part) => {}
            _ => return file_path.to_string(),
        }
    }
    let relative: Vec<&str> = parts.collect();
    if relative.is_empty() {
        return file_path.to_string();
    }
    relative.join("/")
}

/// The shard a reference row names by `key`, as the vault scan spells it.
pub(crate) fn shard_path_from_key(vault_path: &Path, key: &str) -> PathBuf {
    if Path::new(key).is_absolute() {
        return PathBuf::from(key);
    }
    key.split('/')
        .fold(vault_path.to_path_buf(), |path, part| path.join(part))
}

/// Forgets every attachment of the vault at `vault_path`, with what refers
/// to them, once its folder is gone.
pub fn forget_vault_attachments(conn: &Connection, vault_path: &Path) -> rusqlite::Result<()> {
    let vault = vault_key(vault_path);
    conn.execute(
        "DELETE FROM attachment_references WHERE vault_path = ?1",
        params![vault],
    )?;
    conn.execute(
        "DELETE FROM attachments WHERE vault_path = ?1",
        params![vault],
    )?;
    Ok(())
}

/// Whether the database has a row for `asset_path` in the vault.
pub(crate) fn is_tracked(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM attachments WHERE vault_path = ?1 AND asset_path = ?2)",
        params![vault_key(vault_path), asset_path],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to query attachment metadata: {}", e))
}

/// Recounts the references to each `(vault key, asset path)` in `attachments`.
pub(crate) fn refresh_attachment_counts(
    conn: &Connection,
    attachments: &HashSet<(String, String)>,
) -> Result<(), String> {
    let now = now_unix_seconds();

    for (vault, asset_path) in attachments {
        let ref_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM attachment_references WHERE vault_path = ?1 AND asset_path = ?2",
                params![vault, asset_path],
                |row| row.get(0),
            )
            .map_err(|e| format!("Failed to count attachment references: {}", e))?;

        if ref_count > 0 {
            conn.execute(
                "UPDATE attachments SET ref_count = ?1, last_referenced_at = ?2, gc_candidate_at = NULL, updated_at = ?2 WHERE vault_path = ?3 AND asset_path = ?4",
                params![ref_count, now, vault, asset_path],
            )
            .map_err(|e| format!("Failed to mark attachment as referenced: {}", e))?;
        } else {
            conn.execute(
                "UPDATE attachments SET ref_count = 0, gc_candidate_at = COALESCE(gc_candidate_at, ?1), updated_at = ?1 WHERE vault_path = ?2 AND asset_path = ?3",
                params![now, vault, asset_path],
            )
            .map_err(|e| format!("Failed to mark attachment as GC candidate: {}", e))?;
        }
    }

    Ok(())
}

/// The `(vault key, asset path)` of every attachment the shard at `key`
/// in the vault links to.
pub(crate) fn referenced_attachments(
    conn: &Connection,
    vault: &str,
    key: &str,
) -> Result<HashSet<(String, String)>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT vault_path, asset_path FROM attachment_references WHERE vault_path = ?1 AND file_path = ?2",
        )
        .map_err(|e| format!("Failed to prepare attachment reference query: {}", e))?;
    let rows = stmt
        .query_map(params![vault, key], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("Failed to query attachment references: {}", e))?;

    Ok(rows.filter_map(Result::ok).collect())
}

pub fn rename_reference_file_path(
    conn: &Connection,
    vault_path: &Path,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE OR REPLACE attachment_references SET file_path = ?1 WHERE vault_path = ?2 AND file_path = ?3",
        params![
            shard_key(vault_path, new_path),
            vault_key(vault_path),
            shard_key(vault_path, old_path)
        ],
    )
    .map_err(|e| format!("Failed to rename attachment references: {}", e))?;

    Ok(())
}

pub fn remove_references_for_markdown_file(
    conn: &Connection,
    vault_path: &Path,
    file_path: &str,
) -> Result<(), String> {
    remove_references_for_key(
        conn,
        &vault_key(vault_path),
        &shard_key(vault_path, file_path),
    )
}

/// [`remove_references_for_markdown_file`] for a shard named as its rows
/// name it.
pub(crate) fn remove_references_for_key(
    conn: &Connection,
    vault: &str,
    key: &str,
) -> Result<(), String> {
    let previous = referenced_attachments(conn, vault, key)?;

    conn.execute(
        "DELETE FROM attachment_references WHERE vault_path = ?1 AND file_path = ?2",
        params![vault, key],
    )
    .map_err(|e| format!("Failed to delete attachment references: {}", e))?;

    refresh_attachment_counts(conn, &previous)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_windows_spelling_of_a_shard_is_one_key() {
        let vault = r"C:\Users\me\My Vault";
        for spelling in [
            r"C:\Users\me\My Vault\Folder\Media.md",
            // The assistant's tools: the vault joined with a `/` path.
            r"C:\Users\me\My Vault\Folder/Media.md",
            r"C:/Users/me/My Vault/Folder/Media.md",
            r"c:\users\me\my vault\Folder\.\Media.md",
            r"C:\Users\me\My Vault\\Folder\Media.md",
        ] {
            assert_eq!(
                shard_key_in(PathStyle::WINDOWS, vault, spelling),
                "Folder/Media.md",
                "{spelling}"
            );
        }
        assert_eq!(
            shard_key_in(
                PathStyle::WINDOWS,
                &format!(r"{vault}\"),
                r"C:\Users\me\My Vault\Health.md"
            ),
            "Health.md"
        );
    }

    #[test]
    fn paths_outside_the_vault_keep_their_spelling() {
        let outside = r"C:\Users\me\Other\Media.md";
        assert_eq!(
            shard_key_in(PathStyle::WINDOWS, r"C:\Users\me\My Vault", outside),
            outside
        );
        assert_eq!(
            shard_key_in(PathStyle::UNIX, "/home/me/vault", "/home/me/vaults/a.md"),
            "/home/me/vaults/a.md"
        );
    }

    #[test]
    fn unix_names_keep_their_backslashes_and_case() {
        assert_eq!(
            shard_key_in(PathStyle::UNIX, "/v", r"/v/Folder/a\b.md"),
            r"Folder/a\b.md"
        );
        assert_eq!(shard_key_in(PathStyle::UNIX, "/v", "/V/a.md"), "/V/a.md");
    }

    #[test]
    fn a_key_leads_back_to_the_scanned_path() {
        let vault = Path::new("/home/me/vault");
        let scanned = vault.join("Folder").join("Media.md");
        let key = shard_key(vault, &scanned.to_string_lossy());
        assert_eq!(key, "Folder/Media.md");
        assert_eq!(shard_path_from_key(vault, &key), scanned);
    }
}
