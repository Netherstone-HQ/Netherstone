//! Drawing pictures: the light and dark pictures the app exports for a
//! drawing a shard shows. The app makes them again whenever they're missing,
//! so unlike files the user added, they go to the Trash as soon as no shard
//! uses them: an older pair replaced by a new export, or the pair of a
//! drawing that was deleted.

use rusqlite::{Connection, params};
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::cleanup::prune_empty_attachment_folders;
use super::policy::{ATTACHMENTS_DIR_NAME, path_from_asset_path};
use super::references::{parse_attachment_references, parse_drawing_exports};
use crate::db::attachments::vault_key;

/// Remembers the drawing pictures `content` shows, so they can go once no
/// shard uses them.
pub(crate) fn record_drawing_pictures(
    conn: &Connection,
    vault_path: &Path,
    content: &str,
) -> Result<(), String> {
    if !content.contains("data-dark-src") && !content.contains("data-excalidraw") {
        return Ok(());
    }
    let vault = vault_key(vault_path);
    for export in parse_drawing_exports(content) {
        for asset_path in std::iter::once(export.asset_path).chain(export.dark_asset_path) {
            conn.execute(
                "INSERT OR IGNORE INTO drawing_pictures (vault_path, asset_path) VALUES (?1, ?2)",
                params![vault, asset_path],
            )
            .map_err(|e| format!("Failed to record drawing picture: {}", e))?;
        }
    }
    Ok(())
}

/// The vault's drawing pictures.
pub(crate) fn drawing_pictures(
    conn: &Connection,
    vault_path: &Path,
) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("SELECT asset_path FROM drawing_pictures WHERE vault_path = ?1")
        .map_err(|e| format!("Failed to prepare drawing picture query: {}", e))?;
    let rows = stmt
        .query_map(params![vault_key(vault_path)], |row| row.get(0))
        .map_err(|e| format!("Failed to query drawing pictures: {}", e))?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Drawing pictures no saved shard links to, by the index.
fn unlinked_drawing_pictures(conn: &Connection, vault: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT p.asset_path FROM drawing_pictures p
             WHERE p.vault_path = ?1 AND NOT EXISTS (
                 SELECT 1 FROM attachment_references r
                 WHERE r.vault_path = p.vault_path AND r.asset_path = p.asset_path
             )",
        )
        .map_err(|e| format!("Failed to prepare drawing picture query: {}", e))?;
    let rows = stmt
        .query_map(params![vault], |row| row.get(0))
        .map_err(|e| format!("Failed to query drawing pictures: {}", e))?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn forget(conn: &Connection, vault: &str, asset_path: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM drawing_pictures WHERE vault_path = ?1 AND asset_path = ?2",
        params![vault, asset_path],
    )
    .map_err(|e| format!("Failed to forget drawing picture: {}", e))?;
    Ok(())
}

/// Whether `content` uses the file at `asset_path`: links to it, or names
/// it anywhere, as it would in a link written some other way.
fn uses(content: &str, linked: &HashSet<String>, asset_path: &str) -> bool {
    let name = asset_path.rsplit('/').next().unwrap_or(asset_path);
    linked.contains(asset_path)
        || content.contains(name)
        || content.contains(&name.replace(' ', "%20"))
}

/// Moves the drawing pictures no shard uses to the Trash with `remove`, and
/// returns them. The index picks the candidates, so no shard is read when
/// there are none; each candidate is then looked for in every shard of
/// `shard_paths`, so a link the index missed keeps its picture.
/// Just before removing, the index is checked again under `hold`, which
/// keeps saves out, so a link saved meanwhile keeps its picture too.
pub fn remove_unused_drawing_pictures<G>(
    conn: &Connection,
    vault_path: &Path,
    shard_paths: impl FnOnce() -> Vec<String>,
    hold: impl FnOnce() -> Result<G, String>,
    remove: impl FnOnce(&[PathBuf]) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let vault = vault_key(vault_path);
    let attachments_dir = vault_path.join(ATTACHMENTS_DIR_NAME);
    let mut candidates = Vec::new();
    for asset_path in unlinked_drawing_pictures(conn, &vault)? {
        match path_from_asset_path(vault_path, &asset_path) {
            Ok(path) if path.starts_with(&attachments_dir) && path.is_file() => {
                candidates.push(asset_path)
            }
            // Already gone, such as removed on another device and synced.
            _ => forget(conn, &vault, &asset_path)?,
        }
    }
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    for shard in shard_paths() {
        let Ok(content) = std::fs::read_to_string(&shard) else {
            continue;
        };
        let linked: HashSet<String> = parse_attachment_references(&content)
            .into_iter()
            .map(|reference| reference.asset_path)
            .collect();
        candidates.retain(|asset_path| !uses(&content, &linked, asset_path));
        if candidates.is_empty() {
            return Ok(Vec::new());
        }
    }

    let _held = hold()?;
    let still_unlinked: HashSet<String> = unlinked_drawing_pictures(conn, &vault)?
        .into_iter()
        .collect();
    candidates.retain(|asset_path| still_unlinked.contains(asset_path));
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let paths: Vec<PathBuf> = candidates
        .iter()
        .filter_map(|asset_path| path_from_asset_path(vault_path, asset_path).ok())
        .collect();
    remove(&paths)?;

    for asset_path in &candidates {
        forget(conn, &vault, asset_path)?;
        conn.execute(
            "DELETE FROM attachments WHERE vault_path = ?1 AND asset_path = ?2",
            params![vault, asset_path],
        )
        .map_err(|e| format!("Failed to forget removed attachment: {}", e))?;
    }
    prune_empty_attachment_folders(vault_path);
    Ok(candidates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::attachments::references::sync_references_for_saved_markdown;
    use crate::db::gallery::list_vault_attachments;

    fn temp_vault(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netherstone-drawing-pictures-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(ATTACHMENTS_DIR_NAME)).unwrap();
        dir
    }

    fn connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn
    }

    fn tag(light: &str, dark: &str) -> String {
        format!(
            "<img src=\"_attachments/{light}\" data-dark-src=\"_attachments/{dark}\" alt=\"Plan\" width=\"480\" data-excalidraw=\"Plan.excalidraw\" />\n"
        )
    }

    fn save(conn: &Connection, vault: &Path, name: &str, content: &str) -> String {
        let path = vault.join(name).to_string_lossy().into_owned();
        std::fs::write(&path, content).unwrap();
        sync_references_for_saved_markdown(conn, vault, &path, content).unwrap();
        path
    }

    fn picture(vault: &Path, name: &str) {
        std::fs::write(vault.join(ATTACHMENTS_DIR_NAME).join(name), name).unwrap();
    }

    fn exists(vault: &Path, name: &str) -> bool {
        vault.join(ATTACHMENTS_DIR_NAME).join(name).is_file()
    }

    fn sweep(conn: &Connection, vault: &Path, shards: &[String]) -> Vec<String> {
        let mut removed = remove_unused_drawing_pictures(
            conn,
            vault,
            || shards.to_vec(),
            || Ok(()),
            |paths| {
                for path in paths {
                    std::fs::remove_file(path).map_err(|e| e.to_string())?;
                }
                Ok(())
            },
        )
        .unwrap();
        removed.sort();
        removed
    }

    fn gallery_names(conn: &Connection, vault: &Path) -> Vec<String> {
        let mut names: Vec<String> = list_vault_attachments(conn, vault)
            .unwrap()
            .into_iter()
            .map(|file| file.name)
            .collect();
        names.sort();
        names
    }

    #[test]
    fn replaced_and_deleted_drawing_pictures_go_and_shown_ones_stay() {
        let vault = temp_vault("lifecycle");
        let conn = connection();
        for name in [
            "Plan.png",
            "Plan-dark.png",
            "Plan-1.png",
            "Plan-dark-1.png",
            "Map.png",
            "Map-dark.png",
            "Photo.png",
        ] {
            picture(&vault, name);
        }
        // A shard shows the drawing, then a new export replaces its pictures.
        let notes = save(&conn, &vault, "Notes.md", &tag("Plan.png", "Plan-dark.png"));
        save(
            &conn,
            &vault,
            "Notes.md",
            &tag("Plan-1.png", "Plan-dark-1.png"),
        );
        // Another drawing another shard shows, and a picture the user added
        // that nothing uses.
        let atlas = save(&conn, &vault, "Atlas.md", &tag("Map.png", "Map-dark.png"));
        // A shard the index doesn't know yet, such as one just synced in,
        // that still shows the old dark picture.
        let synced = vault.join("Synced.md").to_string_lossy().into_owned();
        std::fs::write(
            &synced,
            tag("Plan.png", "Plan-dark.png").replace("Plan.png", ""),
        )
        .unwrap();
        let shards = [notes.clone(), atlas.clone(), synced.clone()];

        assert_eq!(
            gallery_names(&conn, &vault),
            ["Map.png", "Photo.png", "Plan-1.png"],
            "the replaced pair isn't shown"
        );
        assert_eq!(sweep(&conn, &vault, &shards), ["_attachments/Plan.png"]);
        assert!(exists(&vault, "Plan-dark.png"));

        // The drawing is deleted and taken out of the shards.
        std::fs::remove_file(&synced).unwrap();
        save(&conn, &vault, "Notes.md", "No drawing now.\n");
        assert_eq!(gallery_names(&conn, &vault), ["Map.png", "Photo.png"]);
        assert_eq!(
            sweep(&conn, &vault, &[notes, atlas.clone()]),
            [
                "_attachments/Plan-1.png",
                "_attachments/Plan-dark-1.png",
                "_attachments/Plan-dark.png"
            ]
        );
        for name in ["Map.png", "Map-dark.png", "Photo.png"] {
            assert!(exists(&vault, name), "{name} stays");
        }
        assert!(!exists(&vault, "Plan-1.png"));
        assert_eq!(gallery_names(&conn, &vault), ["Map.png", "Photo.png"]);
        // Nothing left to look for, so no shard is read.
        let read = std::cell::Cell::new(false);
        let removed = remove_unused_drawing_pictures(
            &conn,
            &vault,
            || {
                read.set(true);
                vec![atlas]
            },
            || Ok(()),
            |_| Ok(()),
        )
        .unwrap();
        assert!(removed.is_empty());
        assert!(!read.get());
        std::fs::remove_dir_all(&vault).unwrap();
    }

    #[test]
    fn a_picture_linked_again_while_shards_are_read_stays() {
        let vault = temp_vault("relinked");
        let conn = connection();
        picture(&vault, "Plan.png");
        picture(&vault, "Plan-dark.png");
        let notes = save(&conn, &vault, "Notes.md", &tag("Plan.png", "Plan-dark.png"));
        save(&conn, &vault, "Notes.md", "Taken out.\n");

        let removed = remove_unused_drawing_pictures(
            &conn,
            &vault,
            || vec![notes.clone()],
            || {
                // An undo saved just before removing.
                save(&conn, &vault, "Notes.md", &tag("Plan.png", "Plan-dark.png"));
                Ok(())
            },
            |_| panic!("nothing should be removed"),
        )
        .unwrap();
        assert!(removed.is_empty());
        std::fs::remove_dir_all(&vault).unwrap();
    }
}
