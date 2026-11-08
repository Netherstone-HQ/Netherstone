//! Attachment rows in the database: what links to each file, and counts.

use rusqlite::{Connection, params};
use std::collections::HashSet;
use std::path::Path;
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

/// The `(vault key, asset path)` of every attachment `file_path` links to.
pub(crate) fn referenced_attachments(
    conn: &Connection,
    file_path: &str,
) -> Result<HashSet<(String, String)>, String> {
    let mut stmt = conn
        .prepare("SELECT vault_path, asset_path FROM attachment_references WHERE file_path = ?1")
        .map_err(|e| format!("Failed to prepare attachment reference query: {}", e))?;
    let rows = stmt
        .query_map(params![file_path], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| format!("Failed to query attachment references: {}", e))?;

    Ok(rows.filter_map(Result::ok).collect())
}

pub fn rename_reference_file_path(
    conn: &Connection,
    old_path: &str,
    new_path: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE attachment_references SET file_path = ?1 WHERE file_path = ?2",
        params![new_path, old_path],
    )
    .map_err(|e| format!("Failed to rename attachment references: {}", e))?;

    Ok(())
}

pub fn remove_references_for_markdown_file(
    conn: &Connection,
    file_path: &str,
) -> Result<(), String> {
    let previous = referenced_attachments(conn, file_path)?;

    conn.execute(
        "DELETE FROM attachment_references WHERE file_path = ?1",
        params![file_path],
    )
    .map_err(|e| format!("Failed to delete attachment references: {}", e))?;

    refresh_attachment_counts(conn, &previous)
}
