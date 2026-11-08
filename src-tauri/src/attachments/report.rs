//! The attachment report: missing, unused and outside files.

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;

use super::cleanup::prune_empty_attachment_folders;
use super::policy::{is_hash_stem, normalize_attachment_path, path_from_asset_path};
use super::references::{
    ExternalFile, find_external_files, parse_attachment_references,
    sync_references_for_saved_markdown,
};
use super::store::{
    find_identical_attachment, register_untracked_attachments, scan_attachment_files,
};
use crate::db::attachments::{
    refresh_attachment_counts, remove_references_for_markdown_file, vault_key,
};

/// An attachment that shards in the vault link to but is not on disk.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingAttachment {
    pub asset_path: String,
    pub shard_paths: Vec<String>,
    /// The name the file had when it was imported, if known.
    pub original_name: Option<String>,
    /// A file in the vault with the same content, such as the missing file
    /// after a rename or move, that the links can point to instead.
    pub found_asset_path: Option<String>,
}

/// What is known about one missing attachment.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MissingAttachmentInfo {
    pub original_name: Option<String>,
    pub found_asset_path: Option<String>,
    pub found_absolute_path: Option<String>,
}

/// A file in the vault's attachment folder that no shard links to.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UnusedAttachment {
    pub asset_path: String,
    pub size_bytes: u64,
    /// When the database first saw it unused (unix seconds).
    pub unused_since: Option<i64>,
}

/// The state of a vault's attachments after reconciliation.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentReport {
    pub file_count: usize,
    pub total_bytes: u64,
    pub missing: Vec<MissingAttachment>,
    pub unused: Vec<UnusedAttachment>,
    /// Database rows created for files that were not tracked yet.
    pub registered_count: usize,
    /// Shards whose stale references were dropped because they no longer exist.
    pub removed_shard_count: usize,
    /// Files that shards link to outside the attachment folder.
    pub external_files: Vec<ExternalFile>,
}

/// The original name of a missing attachment and, when a file with the same
/// content is in the vault, its asset path.
fn describe_missing(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
) -> Result<(Option<String>, Option<String>), String> {
    let row: Option<(String, String, String, i64)> = conn
        .query_row(
            "SELECT hash, original_name, extension, size_bytes FROM attachments WHERE vault_path = ?1 AND asset_path = ?2",
            params![vault_key(vault_path), asset_path],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(|e| format!("Failed to query attachment metadata: {}", e))?;

    let Some((hash, original_name, extension, size_bytes)) = row else {
        return Ok((None, None));
    };
    let found = find_identical_attachment(
        conn,
        vault_path,
        &hash,
        &extension,
        size_bytes.max(0) as u64,
        Some(asset_path),
    )?;
    // A hash name says nothing about the file; a readable one is worth showing.
    let original_name = Some(original_name).filter(|name| {
        let stem = Path::new(name)
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or_default();
        !is_hash_stem(stem)
    });

    Ok((original_name, found))
}

/// Looks up a missing attachment for the editor: its original name, and a
/// file with the same content to relink to.
pub fn describe_missing_attachment(
    conn: &Connection,
    vault_path: &Path,
    asset_path: &str,
) -> Result<MissingAttachmentInfo, String> {
    let asset_path = normalize_attachment_path(asset_path)
        .ok_or_else(|| format!("Not a vault attachment: {}", asset_path))?;
    register_untracked_attachments(conn, vault_path, &scan_attachment_files(vault_path))?;
    let (original_name, found_asset_path) = describe_missing(conn, vault_path, &asset_path)?;
    let found_absolute_path = found_asset_path
        .as_deref()
        .and_then(|found| path_from_asset_path(vault_path, found).ok())
        .map(|path| path.to_string_lossy().to_string());

    Ok(MissingAttachmentInfo {
        original_name,
        found_asset_path,
        found_absolute_path,
    })
}

/// Brings the database in line with the vault on disk and reports what is
/// missing or unused.
///
/// - Re-reads the attachment links of every shard in `markdown_paths`, so a
///   database created before attachments were tracked, or edits made outside
///   the app, are picked up.
/// - Drops references from shards under the vault that no longer exist.
/// - Registers files in the attachment folder that the database does not
///   know, so later cleanup can see them.
///
/// The database is shared by every vault, so references are counted only
/// from this vault's shards. Nothing on disk is changed.
pub fn reconcile_vault_attachments(
    conn: &Connection,
    vault_path: &Path,
    markdown_paths: &[String],
) -> Result<AttachmentReport, String> {
    let tx = conn
        .unchecked_transaction()
        .map_err(|e| format!("Failed to start attachment reconciliation: {}", e))?;
    let mut report = AttachmentReport::default();
    let shard_paths: HashSet<&str> = markdown_paths.iter().map(String::as_str).collect();

    // Shards deleted or moved outside the app.
    let vault = vault_key(vault_path);
    let referencing_paths: Vec<String> = {
        let mut stmt = tx
            .prepare("SELECT DISTINCT file_path FROM attachment_references WHERE vault_path = ?1")
            .map_err(|e| format!("Failed to prepare attachment reference query: {}", e))?;
        let rows = stmt
            .query_map(params![vault], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to query attachment references: {}", e))?;
        rows.filter_map(Result::ok).collect()
    };
    for file_path in referencing_paths {
        if !shard_paths.contains(file_path.as_str()) {
            remove_references_for_markdown_file(&tx, &file_path)?;
            report.removed_shard_count += 1;
        }
    }

    // Files on disk the database does not know yet.
    prune_empty_attachment_folders(vault_path);
    let disk_files = scan_attachment_files(vault_path);
    let registered = register_untracked_attachments(&tx, vault_path, &disk_files)?;
    report.registered_count = registered.len();
    let registered_here: HashSet<(String, String)> = registered
        .into_iter()
        .map(|asset_path| (vault.clone(), asset_path))
        .collect();
    refresh_attachment_counts(&tx, &registered_here)?;

    // Current links from every shard.
    let mut shards_by_asset: HashMap<String, Vec<String>> = HashMap::new();
    let mut shard_contents = Vec::new();
    for shard_path in markdown_paths {
        let Ok(content) = std::fs::read_to_string(shard_path) else {
            continue;
        };
        sync_references_for_saved_markdown(&tx, vault_path, shard_path, &content)?;

        let mut seen = HashSet::new();
        for reference in parse_attachment_references(&content) {
            if seen.insert(reference.asset_path.clone()) {
                shards_by_asset
                    .entry(reference.asset_path)
                    .or_default()
                    .push(shard_path.clone());
            }
        }
        shard_contents.push((shard_path.clone(), content));
    }
    report.external_files = find_external_files(vault_path, &shard_contents);

    let on_disk: HashSet<&str> = disk_files.iter().map(|(path, _)| path.as_str()).collect();
    report.file_count = disk_files.len();
    report.total_bytes = disk_files.iter().map(|(_, size)| size).sum();

    for (asset_path, size_bytes) in &disk_files {
        if shards_by_asset.contains_key(asset_path) {
            continue;
        }

        let unused_since: Option<i64> = tx
            .query_row(
                "SELECT gc_candidate_at FROM attachments WHERE vault_path = ?1 AND asset_path = ?2",
                params![vault, asset_path],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to query attachment metadata: {}", e))?
            .flatten();

        report.unused.push(UnusedAttachment {
            asset_path: asset_path.clone(),
            size_bytes: *size_bytes,
            unused_since,
        });
    }

    for (asset_path, mut shards) in shards_by_asset {
        let exists = on_disk.contains(asset_path.as_str())
            || path_from_asset_path(vault_path, &asset_path).is_ok_and(|path| path.exists());
        if !exists {
            shards.sort();
            let (original_name, found_asset_path) = describe_missing(&tx, vault_path, &asset_path)?;
            report.missing.push(MissingAttachment {
                asset_path,
                shard_paths: shards,
                original_name,
                found_asset_path,
            });
        }
    }
    report
        .missing
        .sort_by(|a, b| a.asset_path.cmp(&b.asset_path));

    tx.commit()
        .map_err(|e| format!("Failed to save attachment reconciliation: {}", e))?;

    Ok(report)
}
