//! The files the webview may load through the asset protocol (images, audio,
//! video and other files shown in shards). Nothing is allowed at start; the
//! vault is added when it opens, and each shard adds the files it links to
//! when it is read, so linked files outside the vault still show.

use std::path::Path;
use tauri::{AppHandle, Manager, Runtime};

use crate::db::attachments::linked_local_files;

pub fn allow_vault<R: Runtime>(app: &AppHandle<R>, vault_path: &Path) {
    if let Err(error) = app.asset_protocol_scope().allow_directory(vault_path, true) {
        eprintln!(
            "[Netherstone] Couldn't allow vault files {}: {}",
            vault_path.display(),
            error
        );
    }
}

pub fn allow_linked_files<R: Runtime>(app: &AppHandle<R>, shard_path: &Path, markdown: &str) {
    let scope = app.asset_protocol_scope();
    for file in linked_local_files(shard_path, markdown) {
        if scope.is_allowed(&file) {
            continue;
        }
        if let Err(error) = scope.allow_file(&file) {
            eprintln!(
                "[Netherstone] Couldn't allow linked file {}: {}",
                file.display(),
                error
            );
        }
    }
}
