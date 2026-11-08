use super::cleanup::*;
use super::policy::*;
use super::references::*;
use super::report::*;
use super::store::*;
use crate::db::attachments::*;
use rusqlite::{Connection, params};
use std::path::{Path, PathBuf};

#[test]
fn audio_and_video_sync_under_the_size_limit() {
    for extension in ["mp3", "m4a", "mp4", "mov", "webm"] {
        assert_eq!(
            sync_status_for_attachment(extension, 5 * 1024 * 1024),
            AttachmentSyncStatus::Syncable,
            "{extension}"
        );
        assert_eq!(
            sync_status_for_attachment(extension, SYNC_SOFT_LIMIT_BYTES + 1),
            AttachmentSyncStatus::LocalOnly,
            "{extension}"
        );
    }
}

#[test]
fn a_drawing_image_uses_its_dark_export_too() {
    let paths: Vec<String> = parse_attachment_references(
        "<img src=\"_attachments/Plan.png\" data-dark-src=\"_attachments/Plan-dark.png\" alt=\"Plan\" />\n",
    )
    .into_iter()
    .map(|reference| reference.asset_path)
    .collect();
    assert_eq!(
        paths,
        ["_attachments/Plan.png", "_attachments/Plan-dark.png"]
    );
}

const USED_HASH: &str = "ab00000000000000000000000000000000000000000000000000000000000000";

fn temp_vault(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "netherstone-attachments-{}-{}",
        name,
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("_attachments/ab")).unwrap();
    std::fs::create_dir_all(dir.join("_attachments/cd")).unwrap();
    std::fs::create_dir_all(dir.join("sub")).unwrap();
    dir
}

fn path_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

fn ref_count(conn: &Connection, vault: &Path, asset_path: &str) -> i64 {
    conn.query_row(
        "SELECT ref_count FROM attachments WHERE vault_path = ?1 AND asset_path = ?2",
        params![vault_key(vault), asset_path],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn reconcile_reports_missing_and_unused_and_repairs_references() {
    let vault = temp_vault("reconcile");
    let used = format!("_attachments/ab/{USED_HASH}.png");
    std::fs::write(vault.join(&used), b"png").unwrap();
    std::fs::write(vault.join("_attachments/cd/old.png"), b"old!").unwrap();

    let note = path_string(vault.join("note.md"));
    let nested = path_string(vault.join("sub").join("nested.md"));
    std::fs::write(&note, format!("![a]({used})\n")).unwrap();
    std::fs::write(
        &nested,
        "<img src=\"_attachments/ef/gone.png\" width=\"10\" />\n",
    )
    .unwrap();

    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

    // A shard deleted outside the app, and a shard in another vault that
    // links to the same attachment path.
    let deleted = path_string(vault.join("deleted.md"));
    let other_vault = std::env::temp_dir().join("netherstone-other-vault");
    let other = path_string(other_vault.join("other.md"));
    // The other vault's file is not on this disk, so nothing registered it.
    upsert_attachment_record(
        &conn,
        &other_vault,
        &PersistedAttachment {
            asset_path: "_attachments/cd/old.png".into(),
            absolute_path: String::new(),
            hash: "h".into(),
            original_name: "old.png".into(),
            extension: "png".into(),
            mime_type: "image/png".into(),
            size_bytes: 4,
            sync_status: "syncable".into(),
            sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
        },
    )
    .unwrap();
    for (vault_path, file_path) in [(&vault, &deleted), (&other_vault, &other)] {
        sync_references_for_saved_markdown(
            &conn,
            vault_path,
            file_path,
            "![x](_attachments/cd/old.png)\n",
        )
        .unwrap();
    }

    let report =
        reconcile_vault_attachments(&conn, &vault, &[note.clone(), nested.clone()]).unwrap();

    assert_eq!(report.file_count, 2);
    assert_eq!(report.total_bytes, 7);
    assert_eq!(report.removed_shard_count, 1);
    assert_eq!(report.registered_count, 1);
    assert_eq!(
        report.missing,
        vec![MissingAttachment {
            asset_path: "_attachments/ef/gone.png".into(),
            shard_paths: vec![nested.clone()],
            original_name: None,
            found_asset_path: None,
        }]
    );
    // Unused in this vault even though the other vault still links to it.
    assert_eq!(report.unused.len(), 1);
    assert_eq!(report.unused[0].asset_path, "_attachments/cd/old.png");
    assert_eq!(report.unused[0].size_bytes, 4);

    assert_eq!(ref_count(&conn, &vault, &used), 1);
    // Each vault counts its own links to a file of the same name.
    assert_eq!(ref_count(&conn, &vault, "_attachments/cd/old.png"), 0);
    assert_eq!(ref_count(&conn, &other_vault, "_attachments/cd/old.png"), 1);
    assert!(report.unused[0].unused_since.is_some());
    let hash: String = conn
        .query_row(
            "SELECT hash FROM attachments WHERE vault_path = ?1 AND asset_path = ?2",
            params![vault_key(&vault), used],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(hash, USED_HASH);

    // A second run finds nothing new to repair.
    let again = reconcile_vault_attachments(&conn, &vault, &[note, nested]).unwrap();
    assert_eq!(again.removed_shard_count, 0);
    assert_eq!(again.registered_count, 0);
    assert_eq!(again.missing.len(), 1);

    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn a_link_to_a_missing_file_keeps_the_shard_other_links() {
    let vault = temp_vault("missing-link");
    let used = format!("_attachments/ab/{USED_HASH}.png");
    std::fs::write(vault.join(&used), b"png").unwrap();
    let note = path_string(vault.join("note.md"));

    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

    sync_references_for_saved_markdown(
        &conn,
        &vault,
        &note,
        &format!("![gone](_attachments/zz/gone.png)\n\n![a]({used})\n"),
    )
    .unwrap();

    assert_eq!(ref_count(&conn, &vault, &used), 1);
    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn a_link_out_of_the_attachment_folder_is_not_an_attachment() {
    for link in ["_attachments/../note.md", "_attachments/ab/%2E%2E/../x.png"] {
        assert_eq!(normalize_attachment_path(link), None, "{link}");
    }

    let vault = temp_vault("parent-link");
    let used = format!("_attachments/ab/{USED_HASH}.png");
    std::fs::write(vault.join(&used), b"png").unwrap();
    std::fs::write(vault.join("x.png"), b"png").unwrap();
    let note = path_string(vault.join("note.md"));
    std::fs::write(
        &note,
        format!("![out](_attachments/../x.png)\n\n![a]({used})\n"),
    )
    .unwrap();

    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();

    let report = reconcile_vault_attachments(&conn, &vault, &[note]).unwrap();
    assert!(report.missing.is_empty());
    assert_eq!(ref_count(&conn, &vault, &used), 1);
    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn picking_a_file_already_in_attachments_reuses_it() {
    let vault = temp_vault("pick-existing");
    let renamed = vault.join("_attachments/ab/My diagram.png");
    std::fs::write(&renamed, b"png").unwrap();

    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();

    let attachment = persist_attachment_file(&conn, &vault, &renamed).unwrap();
    assert_eq!(attachment.asset_path, "_attachments/ab/My diagram.png");

    let files: Vec<_> = scan_attachment_files(&vault)
        .into_iter()
        .map(|(path, _)| path)
        .collect();
    assert_eq!(files, ["_attachments/ab/My diagram.png"]);
    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn new_attachments_keep_their_name_and_identical_files_are_shared() {
    let vault = temp_vault("readable");
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();

    let first = persist_attachment_bytes(&conn, &vault, "Screen: shot.png", b"one").unwrap();
    assert_eq!(first.asset_path, "_attachments/Screen- shot.png");

    let same = persist_attachment_bytes(&conn, &vault, "copy.png", b"one").unwrap();
    assert_eq!(same.asset_path, first.asset_path);
    assert_eq!(same.original_name, "Screen: shot.png");

    let other = persist_attachment_bytes(&conn, &vault, "Screen: shot.png", b"two").unwrap();
    assert_eq!(other.asset_path, "_attachments/Screen- shot-1.png");

    let reserved = persist_attachment_bytes(&conn, &vault, "CON.txt", b"three").unwrap();
    assert_eq!(reserved.asset_path, "_attachments/CON-file.txt");

    // A file stored under its hash before names were readable is reused.
    let legacy_hash = blake3::hash(b"legacy").to_hex().to_string();
    let legacy = attachment_asset_path(&legacy_hash, "png");
    std::fs::create_dir_all(vault.join(&legacy).parent().unwrap()).unwrap();
    std::fs::write(vault.join(&legacy), b"legacy").unwrap();
    let reused = persist_attachment_bytes(&conn, &vault, "legacy.png", b"legacy").unwrap();
    assert_eq!(reused.asset_path, legacy);

    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn a_name_taken_outside_the_app_is_never_replaced() {
    let vault = temp_vault("taken");
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();
    // Another program put these here; the database knows neither.
    std::fs::create_dir_all(vault.join(ATTACHMENTS_DIR_NAME)).unwrap();
    std::fs::write(vault.join("_attachments/photo.png"), b"theirs").unwrap();
    std::fs::write(vault.join("_attachments/photo-1.png"), b"theirs too").unwrap();

    let ours = persist_attachment_bytes(&conn, &vault, "photo.png", b"ours").unwrap();

    assert_eq!(ours.asset_path, "_attachments/photo-2.png");
    assert_eq!(
        std::fs::read(vault.join("_attachments/photo.png")).unwrap(),
        b"theirs"
    );
    assert_eq!(
        std::fs::read(vault.join("_attachments/photo-1.png")).unwrap(),
        b"theirs too"
    );
    assert_eq!(
        std::fs::read(vault.join(&ours.asset_path)).unwrap(),
        b"ours"
    );
    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn a_picked_file_is_copied_in_and_leaves_nothing_behind() {
    let vault = temp_vault("copy");
    let outside = temp_vault("copy-source");
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();
    let content: Vec<u8> = (0..300_000u32).map(|n| (n % 251) as u8).collect();
    let source = outside.join("Recording.mp3");
    std::fs::write(&source, &content).unwrap();

    let copied = persist_attachment_file(&conn, &vault, &source).unwrap();

    assert_eq!(copied.asset_path, "_attachments/Recording.mp3");
    assert_eq!(copied.size_bytes, content.len() as u64);
    assert_eq!(copied.hash, blake3::hash(&content).to_hex().to_string());
    assert_eq!(
        std::fs::read(vault.join(&copied.asset_path)).unwrap(),
        content
    );
    let mut names: Vec<_> = std::fs::read_dir(vault.join(ATTACHMENTS_DIR_NAME))
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    assert_eq!(names, ["Recording.mp3", "ab", "cd"]);

    // The same file again links the copy already there.
    let again = persist_attachment_file(&conn, &vault, &source).unwrap();
    assert_eq!(again.asset_path, copied.asset_path);
    std::fs::remove_dir_all(&vault).unwrap();
    std::fs::remove_dir_all(&outside).unwrap();
}

#[test]
fn a_renamed_attachment_is_found_by_its_content() {
    let vault = temp_vault("renamed");
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();

    let attachment = persist_attachment_bytes(&conn, &vault, "Diagram.png", b"png").unwrap();
    let note = path_string(vault.join("note.md"));
    std::fs::write(&note, format!("![d](<{}>)\n", attachment.asset_path)).unwrap();
    std::fs::rename(
        vault.join(&attachment.asset_path),
        vault.join("_attachments/cd/Renamed.png"),
    )
    .unwrap();

    let report = reconcile_vault_attachments(&conn, &vault, &[note]).unwrap();
    assert_eq!(report.missing.len(), 1);
    assert_eq!(
        report.missing[0].original_name.as_deref(),
        Some("Diagram.png")
    );
    assert_eq!(
        report.missing[0].found_asset_path.as_deref(),
        Some("_attachments/cd/Renamed.png")
    );

    let info = describe_missing_attachment(&conn, &vault, &attachment.asset_path).unwrap();
    assert_eq!(
        info.found_asset_path.as_deref(),
        Some("_attachments/cd/Renamed.png")
    );
    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn cleanup_removes_only_files_unused_past_the_grace_period() {
    let vault = temp_vault("cleanup");
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();

    let kept = persist_attachment_bytes(&conn, &vault, "kept.png", b"kept").unwrap();
    let old = persist_attachment_bytes(&conn, &vault, "old.png", b"old!").unwrap();
    let recent = persist_attachment_bytes(&conn, &vault, "recent.png", b"new").unwrap();
    let leftover = format!("_attachments/cd/{USED_HASH}.png.tmp");
    std::fs::write(vault.join(&leftover), b"x").unwrap();
    std::fs::write(vault.join("_attachments/.cut.png.netherstone-tmp"), b"y").unwrap();
    // A file the user named .tmp is an attachment like any other.
    std::fs::write(vault.join("_attachments/notes.tmp"), b"z").unwrap();
    let note = path_string(vault.join("note.md"));
    std::fs::write(&note, format!("![k]({})\n", kept.asset_path)).unwrap();

    // Start the clock: both unused files become cleanup candidates now.
    let shards = vec![note.clone()];
    reconcile_vault_attachments(&conn, &vault, &shards).unwrap();
    let now = now_unix_seconds();
    conn.execute(
        "UPDATE attachments SET gc_candidate_at = ?1 WHERE vault_path = ?3 AND asset_path = ?2",
        params![
            now - CLEANUP_GRACE_SECONDS - 1,
            old.asset_path,
            vault_key(&vault)
        ],
    )
    .unwrap();

    let requested = vec![
        kept.asset_path.clone(),
        old.asset_path.clone(),
        recent.asset_path.clone(),
        leftover.clone(),
        "_attachments/.cut.png.netherstone-tmp".to_string(),
        "_attachments/notes.tmp".to_string(),
    ];
    let result = clean_up_vault_attachments(&conn, &vault, &shards, &requested, now, |path| {
        std::fs::remove_file(path).map_err(|e| e.to_string())
    })
    .unwrap();

    assert_eq!(
        result.removed,
        vec![
            old.asset_path.clone(),
            leftover.clone(),
            "_attachments/.cut.png.netherstone-tmp".to_string()
        ]
    );
    assert_eq!(result.freed_bytes, 6);
    assert_eq!(
        result.kept,
        vec![
            kept.asset_path.clone(),
            recent.asset_path.clone(),
            "_attachments/notes.tmp".to_string()
        ]
    );
    assert!(vault.join("_attachments/notes.tmp").is_file());
    assert!(vault.join(&kept.asset_path).is_file());
    assert!(vault.join(&recent.asset_path).is_file());
    assert!(!vault.join(&old.asset_path).exists());
    // The emptied hash folder is gone; the attachment root stays.
    assert!(!vault.join("_attachments/cd").exists());
    assert!(vault.join("_attachments").is_dir());

    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn report_lists_external_files() {
    let vault = temp_vault("external");
    let conn = Connection::open_in_memory().unwrap();
    crate::db::init_schema(&conn).unwrap();

    // A file elsewhere in the vault, one outside it, and an old
    // hash-named one, which still counts as an attachment.
    std::fs::create_dir_all(vault.join("images")).unwrap();
    std::fs::write(vault.join("images/a b.png"), b"a").unwrap();
    let outside =
        std::env::temp_dir().join(format!("netherstone-outside-{}.pdf", std::process::id()));
    std::fs::write(&outside, b"pdf").unwrap();
    let hash = blake3::hash(b"legacy").to_hex().to_string();
    let legacy = attachment_asset_path(&hash, "png");
    std::fs::create_dir_all(vault.join(&legacy).parent().unwrap()).unwrap();
    std::fs::write(vault.join(&legacy), b"legacy").unwrap();
    upsert_attachment_record(
        &conn,
        &vault,
        &PersistedAttachment {
            asset_path: legacy.clone(),
            absolute_path: String::new(),
            hash: hash.clone(),
            original_name: "Diagram.png".into(),
            extension: "png".into(),
            mime_type: "image/png".into(),
            size_bytes: 6,
            sync_status: "syncable".into(),
            sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
        },
    )
    .unwrap();

    let note = path_string(vault.join("sub").join("note.md"));
    let outside_link = outside.to_string_lossy().into_owned();
    std::fs::write(
        &note,
        format!(
            "![a](<../images/a b.png>)\n\n![b](../images/a%20b.png)\n\n\
             <file name=\"x\" src=\"{outside_link}\" />\n\n\
             [web](https://example.com/a.png) [note](other.md) ![l]({legacy})\n"
        ),
    )
    .unwrap();

    // Folders left empty, or holding only system files.
    std::fs::create_dir_all(vault.join("_attachments/1a")).unwrap();
    std::fs::create_dir_all(vault.join("_attachments/1b/nested")).unwrap();
    std::fs::write(vault.join("_attachments/1b/Thumbs.db"), b"x").unwrap();

    let report = reconcile_vault_attachments(&conn, &vault, std::slice::from_ref(&note)).unwrap();
    assert!(!vault.join("_attachments/1a").exists());
    assert!(!vault.join("_attachments/1b").exists());

    let in_vault = report
        .external_files
        .iter()
        .find(|file| file.inside_vault)
        .unwrap();
    assert!(in_vault.absolute_path.ends_with("a b.png"));
    assert_eq!(
        in_vault
            .uses
            .iter()
            .map(|u| u.link.as_str())
            .collect::<Vec<_>>(),
        ["../images/a b.png", "../images/a%20b.png"]
    );
    let device = report
        .external_files
        .iter()
        .find(|file| !file.inside_vault)
        .unwrap();
    assert_eq!(device.uses[0].link, outside_link);
    assert_eq!(report.external_files.len(), 2);
    assert!(report.missing.is_empty());

    std::fs::remove_file(&outside).unwrap();
    std::fs::remove_dir_all(&vault).unwrap();
}

#[test]
fn sync_info_reads_the_file_as_it_is_now() {
    let vault = temp_vault("sync-info");
    std::fs::write(vault.join("_attachments/Interview.mp3"), b"mp3").unwrap();
    std::fs::write(vault.join("_attachments/setup.exe"), b"exe").unwrap();

    let info = attachment_sync_info(&vault, "_attachments/Interview.mp3").unwrap();
    assert_eq!(
        info,
        Some(AttachmentSyncInfo {
            extension: "mp3".into(),
            size_bytes: 3,
            sync_status: "syncable".into(),
            sync_limit_bytes: SYNC_SOFT_LIMIT_BYTES,
        })
    );
    let blocked = attachment_sync_info(&vault, "_attachments/setup.exe").unwrap();
    assert_eq!(blocked.unwrap().sync_status, "blocked");
    assert_eq!(
        attachment_sync_info(&vault, "_attachments/gone.png").unwrap(),
        None
    );
    assert!(attachment_sync_info(&vault, "notes/a.png").is_err());
    assert!(attachment_sync_info(&vault, "_attachments/../secret.txt").is_err());

    std::fs::remove_dir_all(&vault).unwrap();
}

#[cfg(unix)]
#[test]
fn sync_info_ignores_links_to_files_outside_the_attachment_folder() {
    let vault = temp_vault("sync-info-links");
    let outside = temp_vault("sync-info-outside");
    std::fs::write(outside.join("secret.pdf"), b"secret").unwrap();
    std::fs::write(vault.join("_attachments/a.pdf"), b"pdf").unwrap();
    let link = |target: &Path, name: &str| {
        std::os::unix::fs::symlink(target, vault.join("_attachments").join(name)).unwrap()
    };
    link(&outside.join("secret.pdf"), "secret.pdf");
    link(&outside, "aa");
    link(&vault.join("_attachments/a.pdf"), "same.pdf");

    assert_eq!(
        attachment_sync_info(&vault, "_attachments/secret.pdf"),
        Ok(None)
    );
    assert_eq!(
        attachment_sync_info(&vault, "_attachments/aa/secret.pdf"),
        Ok(None)
    );
    assert_eq!(
        attachment_sync_info(&vault, "_attachments/same.pdf")
            .unwrap()
            .map(|info| info.size_bytes),
        Some(3)
    );

    std::fs::remove_dir_all(&vault).unwrap();
    std::fs::remove_dir_all(&outside).unwrap();
}
