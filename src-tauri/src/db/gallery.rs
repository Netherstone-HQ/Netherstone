use rusqlite::Connection;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::UNIX_EPOCH;

use super::attachments::{
    AttachmentReferenceKind, extension_for_name, parse_drawing_exports, reference_kind_for_path,
    scan_attachment_files,
};

/// A file in the vault's attachment folder, as the Gallery shows it.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GalleryFile {
    pub asset_path: String,
    /// A drawing's dark export, shown instead in dark themes.
    pub dark_asset_path: Option<String>,
    pub name: String,
    /// image, drawing, pdf, audio, video or other.
    pub kind: &'static str,
    /// With the dark export, if there is one.
    pub size_bytes: u64,
    /// Seconds since the epoch.
    pub added_at: i64,
    /// The vault's shards that embed or link the file, sorted.
    pub shard_paths: Vec<String>,
}

fn kind_for(asset_path: &str, is_drawing: bool) -> &'static str {
    if is_drawing {
        return "drawing";
    }
    match reference_kind_for_path(asset_path, AttachmentReferenceKind::File) {
        AttachmentReferenceKind::Image => "image",
        AttachmentReferenceKind::Audio => "audio",
        AttachmentReferenceKind::Video => "video",
        AttachmentReferenceKind::File if extension_for_name(asset_path) == "pdf" => "pdf",
        AttachmentReferenceKind::File => "other",
    }
}

/// Leftovers from an interrupted write and hidden files are not attachments.
fn is_listed(asset_path: &str) -> bool {
    let name = asset_path.rsplit('/').next().unwrap_or(asset_path);
    !name.starts_with('.') && !name.ends_with(".tmp")
}

fn modified_seconds(path: &Path) -> i64 {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_secs() as i64)
}

/// Every file in the vault's attachment folder with the vault's shards that
/// use it, newest added first. A drawing export and its dark twin are one
/// file. The database is shared by every vault, so only references from
/// this vault's shards count.
pub fn list_vault_attachments(
    conn: &Connection,
    vault_path: &Path,
) -> Result<Vec<GalleryFile>, String> {
    let added_at: HashMap<String, i64> = {
        let mut stmt = conn
            .prepare("SELECT asset_path, created_at FROM attachments")
            .map_err(|e| format!("Failed to prepare attachment query: {}", e))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| format!("Failed to query attachments: {}", e))?;
        rows.filter_map(Result::ok).collect()
    };

    let mut shards_by_asset: HashMap<String, Vec<String>> = HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT file_path, asset_path FROM attachment_references")
            .map_err(|e| format!("Failed to prepare attachment reference query: {}", e))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get(1)?)))
            .map_err(|e| format!("Failed to query attachment references: {}", e))?;
        for (file_path, asset_path) in rows.filter_map(Result::ok) {
            if Path::new(&file_path).starts_with(vault_path) {
                shards_by_asset
                    .entry(asset_path)
                    .or_default()
                    .push(file_path);
            }
        }
    }

    // Light export -> dark export, from the shards that embed them.
    let mut dark_twins: HashMap<String, Option<String>> = HashMap::new();
    let shard_paths: HashSet<&String> = shards_by_asset.values().flatten().collect();
    for shard_path in shard_paths {
        let Ok(content) = std::fs::read_to_string(shard_path) else {
            continue;
        };
        for export in parse_drawing_exports(&content) {
            let dark = dark_twins.entry(export.asset_path).or_default();
            if dark.is_none() {
                *dark = export.dark_asset_path;
            }
        }
    }

    let disk_files: HashMap<String, u64> = scan_attachment_files(vault_path)
        .into_iter()
        .filter(|(asset_path, _)| is_listed(asset_path))
        .collect();
    let shown_with_light: HashSet<&str> = dark_twins
        .iter()
        .filter(|(light, _)| disk_files.contains_key(*light))
        .filter_map(|(_, dark)| dark.as_deref())
        .collect();

    let mut files = Vec::new();
    for (asset_path, size_bytes) in &disk_files {
        if shown_with_light.contains(asset_path.as_str()) {
            continue;
        }
        let dark_asset_path = dark_twins
            .get(asset_path)
            .cloned()
            .flatten()
            .filter(|dark| disk_files.contains_key(dark));

        let mut shard_paths: Vec<String> = shards_by_asset
            .get(asset_path)
            .into_iter()
            .chain(
                dark_asset_path
                    .as_ref()
                    .and_then(|dark| shards_by_asset.get(dark)),
            )
            .flatten()
            .cloned()
            .collect();
        shard_paths.sort();
        shard_paths.dedup();

        let name = asset_path
            .rsplit('/')
            .next()
            .unwrap_or(asset_path)
            .to_string();
        files.push(GalleryFile {
            kind: kind_for(asset_path, dark_twins.contains_key(asset_path)),
            size_bytes: size_bytes
                + dark_asset_path
                    .as_ref()
                    .and_then(|dark| disk_files.get(dark))
                    .copied()
                    .unwrap_or(0),
            added_at: added_at
                .get(asset_path)
                .copied()
                .unwrap_or_else(|| modified_seconds(&vault_path.join(asset_path))),
            asset_path: asset_path.clone(),
            dark_asset_path,
            name,
            shard_paths,
        });
    }

    files.sort_by(|a, b| {
        b.added_at
            .cmp(&a.added_at)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::attachments::sync_references_for_saved_markdown;
    use crate::db::init_schema;
    use rusqlite::params;
    use std::path::PathBuf;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netherstone-gallery-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("_attachments")).unwrap();
        dir
    }

    fn connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_schema(&conn).unwrap();
        conn
    }

    fn write(vault: &Path, relative: &str, content: &str) -> String {
        let path = vault.join(relative);
        std::fs::write(&path, content).unwrap();
        path.to_string_lossy().to_string()
    }

    fn register(conn: &Connection, asset_path: &str, created_at: i64) {
        conn.execute(
            "INSERT INTO attachments (asset_path, hash, original_name, extension, mime_type, size_bytes, created_at, sync_status)
             VALUES (?1, ?1, ?1, '', '', 0, ?2, 'syncable')",
            params![asset_path, created_at],
        )
        .unwrap();
    }

    fn save_shard(conn: &Connection, vault: &Path, name: &str, content: &str) -> String {
        let path = write(vault, name, content);
        sync_references_for_saved_markdown(conn, &path, content).unwrap();
        path
    }

    #[test]
    fn lists_files_newest_first_with_their_kinds_and_shards() {
        let vault = temp_vault("list");
        let conn = connection();
        for (name, created_at) in [
            ("Trip.jpg", 30),
            ("Guide.pdf", 20),
            ("Talk.mp3", 10),
            ("Clip.mp4", 40),
            ("Notes.zip", 50),
        ] {
            write(&vault, &format!("_attachments/{name}"), "bytes");
            register(&conn, &format!("_attachments/{name}"), created_at);
        }
        let plan = save_shard(&conn, &vault, "Plan.md", "![](_attachments/Trip.jpg)\n");
        let trip = save_shard(
            &conn,
            &vault,
            "Trip.md",
            "![](_attachments/Trip.jpg)\n\n[Guide](_attachments/Guide.pdf)\n",
        );

        let files = list_vault_attachments(&conn, &vault).unwrap();
        let summary: Vec<(&str, &str, usize)> = files
            .iter()
            .map(|file| (file.name.as_str(), file.kind, file.shard_paths.len()))
            .collect();
        assert_eq!(
            summary,
            [
                ("Notes.zip", "other", 0),
                ("Clip.mp4", "video", 0),
                ("Trip.jpg", "image", 2),
                ("Guide.pdf", "pdf", 1),
                ("Talk.mp3", "audio", 0),
            ]
        );
        assert_eq!(files[2].shard_paths, [plan, trip.clone()]);
        assert_eq!(files[3].shard_paths, [trip]);
        assert_eq!(files[2].size_bytes, 5);
    }

    #[test]
    fn shows_a_drawing_and_its_dark_export_as_one_file() {
        let vault = temp_vault("drawing");
        let conn = connection();
        write(&vault, "_attachments/Map.png", "light");
        write(&vault, "_attachments/Map-dark.png", "dark!!");
        write(&vault, "_attachments/Photo.png", "photo");
        let shard = save_shard(
            &conn,
            &vault,
            "Plan.md",
            "<img src=\"_attachments/Map.png\" data-dark-src=\"_attachments/Map-dark.png\" alt=\"Map\" width=\"400\" data-excalidraw=\"Map.excalidraw\" />\n\n![](_attachments/Photo.png)\n",
        );

        let mut files = list_vault_attachments(&conn, &vault).unwrap();
        files.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].name, "Map.png");
        assert_eq!(files[0].kind, "drawing");
        assert_eq!(
            files[0].dark_asset_path.as_deref(),
            Some("_attachments/Map-dark.png")
        );
        assert_eq!(files[0].size_bytes, 11);
        assert_eq!(files[0].shard_paths, [shard]);
        assert_eq!(files[1].kind, "image");
        assert_eq!(files[1].dark_asset_path, None);
    }

    #[test]
    fn counts_only_this_vaults_shards_and_skips_leftovers() {
        let vault = temp_vault("scoped");
        let other = temp_vault("scoped-other");
        let conn = connection();
        write(&vault, "_attachments/Pic.png", "png");
        write(&vault, "_attachments/Pic.png.tmp", "half");
        write(&vault, "_attachments/.Pic.png.netherstone-tmp", "half");
        write(&other, "_attachments/Pic.png", "png");
        save_shard(&conn, &other, "Elsewhere.md", "![](_attachments/Pic.png)\n");

        let files = list_vault_attachments(&conn, &vault).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "Pic.png");
        assert!(files[0].shard_paths.is_empty());
    }
}
