//! What other apps hand Netherstone on a phone: a file opened with it (Open
//! with) or text, links and files shared with it (Share).
//!
//! Android's MainActivity copies each arrival into the app's cache, as
//! `incoming/opened/<time>/` or `incoming/shared/<time>/`, and renames it
//! there from `<time>.part` once complete (see Incoming.kt). Taking one moves
//! it to `incoming/taken/`, which the app clears when it next starts.
//!
//! Only the system puts files there: no command writes to that folder, so
//! the files the page may then read are ones a person handed over.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const FOLDER: &str = "incoming";
const OPENED: &str = "opened";
const SHARED: &str = "shared";
const TAKEN: &str = "taken";
/// A share's text, subject and files, beside the files.
const ABOUT: &str = "share.json";
/// The ending of an arrival still being copied.
const PART: &str = "part";

/// The cache folder arrivals wait in.
fn incoming_folder(app: &tauri::AppHandle) -> Option<PathBuf> {
    use tauri::Manager;
    app.path()
        .app_cache_dir()
        .ok()
        .map(|cache| cache.join(FOLDER))
}

/// The complete arrivals of `kind`, oldest first.
fn arrivals(incoming: &Path, kind: &str) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(incoming.join(kind)) else {
        return Vec::new();
    };
    let mut found: Vec<(u128, PathBuf)> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.extension().is_none_or(|ending| ending != PART))
        .filter_map(|path| {
            let time = path.file_name()?.to_str()?.parse().ok()?;
            Some((time, path))
        })
        .collect();
    found.sort();
    found.into_iter().map(|(_, path)| path).collect()
}

/// Moves `arrival` of `kind` to the taken folder and returns where it is now.
fn take(incoming: &Path, kind: &str, arrival: &Path) -> Option<PathBuf> {
    let name = arrival.file_name()?.to_str()?;
    let taken = incoming.join(TAKEN).join(format!("{kind}-{name}"));
    fs::create_dir_all(incoming.join(TAKEN)).ok()?;
    match fs::rename(arrival, &taken) {
        Ok(()) => Some(taken),
        Err(error) => {
            eprintln!(
                "[Netherstone] Couldn't take {}: {error}",
                arrival.display()
            );
            None
        }
    }
}

/// The files in `folder`, by name.
fn files_in(folder: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = fs::read_dir(folder)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_file())
                .collect()
        })
        .unwrap_or_default();
    files.sort();
    files
}

/// Takes the files opened with the app since the last take, for the launch
/// to import (see launch.rs).
pub fn take_opened(app: &tauri::AppHandle) -> Vec<PathBuf> {
    incoming_folder(app)
        .map(|incoming| opened_in(&incoming))
        .unwrap_or_default()
}

fn opened_in(incoming: &Path) -> Vec<PathBuf> {
    arrivals(incoming, OPENED)
        .iter()
        .filter_map(|arrival| take(incoming, OPENED, arrival))
        .flat_map(|taken| files_in(&taken))
        .collect()
}

/// What was shared with the app, for the page to save in a shard.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Shared {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub files: Vec<SharedFile>,
}

/// A file that was shared: its name, its type as the other app gave it
/// (`image/png`, or "" when it didn't), and where it is now.
#[derive(Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SharedFile {
    pub name: String,
    #[serde(default, rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub path: String,
}

/// The shared files the page may save into a vault: the latest share's.
static SHAREABLE: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Takes the latest share, if one came since the last take. Older ones are
/// set aside unsaved: a person shares one thing at a time.
fn shared_in(incoming: &Path) -> Option<Shared> {
    let taken: Vec<PathBuf> = arrivals(incoming, SHARED)
        .iter()
        .filter_map(|arrival| take(incoming, SHARED, arrival))
        .collect();
    let latest = taken.last()?;
    let about = fs::read_to_string(latest.join(ABOUT)).unwrap_or_default();
    let mut shared: Shared = serde_json::from_str(&about).unwrap_or_default();
    // Only files in the share's own folder, named as the folder has them.
    shared.files.retain_mut(|file| {
        let path = latest.join(&file.name);
        let own = Path::new(&file.name).file_name() == Some(file.name.as_ref());
        file.path = path.to_string_lossy().into_owned();
        own && file.name != ABOUT && path.is_file()
    });
    Some(shared)
}

/// The latest share, if one came since the last take. Its files may then be
/// saved into a vault with `save_shared_file`.
#[tauri::command(async)]
pub(crate) fn take_shared(app: tauri::AppHandle) -> Option<Shared> {
    let shared = shared_in(&incoming_folder(&app)?)?;
    *SHAREABLE.lock().unwrap_or_else(|e| e.into_inner()) = shared
        .files
        .iter()
        .map(|file| PathBuf::from(&file.path))
        .collect();
    Some(shared)
}

/// Copies a file of the latest share into the vault's attachments.
#[tauri::command(async)]
pub(crate) fn save_shared_file(
    app: tauri::AppHandle,
    path: String,
    vault_path: String,
) -> Result<crate::attachments::store::PersistedAttachment, String> {
    let shareable = SHAREABLE.lock().unwrap_or_else(|e| e.into_inner());
    if !shareable.iter().any(|file| file == Path::new(&path)) {
        return Err(format!("{path} wasn't shared with the app"));
    }
    drop(shareable);
    crate::attachments::commands::copy_into_attachments(&app, &path, &vault_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    fn arrive(incoming: &Path, kind: &str, name: &str, files: &[(&str, &str)]) -> PathBuf {
        let folder = incoming.join(kind).join(name);
        fs::create_dir_all(&folder).unwrap();
        for (file, text) in files {
            fs::write(folder.join(file), text).unwrap();
        }
        folder
    }

    #[test]
    fn takes_opened_files_once() {
        let incoming = temp_dir("incoming-opened");
        arrive(&incoming, OPENED, "200", &[("Plan.md", "# Plan")]);
        arrive(&incoming, OPENED, "100", &[("Notes.txt", "notes")]);
        arrive(&incoming, OPENED, "300.part", &[("Half.md", "")]);

        let names: Vec<String> = opened_in(&incoming)
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, ["Notes.txt", "Plan.md"]);
        assert!(opened_in(&incoming).is_empty(), "taken already");
        assert!(incoming.join(OPENED).join("300.part").exists(), "still copying");
    }

    #[test]
    fn takes_the_latest_share() {
        let incoming = temp_dir("incoming-shared");
        arrive(
            &incoming,
            SHARED,
            "100",
            &[(ABOUT, r#"{"text":"older","files":[]}"#)],
        );
        arrive(
            &incoming,
            SHARED,
            "200",
            &[
                ("photo.jpg", "jpeg"),
                (
                    ABOUT,
                    r#"{"text":"https://example.com","subject":"Example","files":[
                        {"name":"photo.jpg","type":"image/jpeg"},
                        {"name":"../outside.md","type":""},
                        {"name":"missing.png","type":"image/png"}]}"#,
                ),
            ],
        );

        let shared = shared_in(&incoming).unwrap();
        assert_eq!(shared.text.as_deref(), Some("https://example.com"));
        assert_eq!(shared.subject.as_deref(), Some("Example"));
        let names: Vec<&str> = shared.files.iter().map(|file| file.name.as_str()).collect();
        assert_eq!(names, ["photo.jpg"]);
        assert_eq!(shared.files[0].kind, "image/jpeg");
        assert!(Path::new(&shared.files[0].path).is_file());
        assert_eq!(shared_in(&incoming), None, "taken already");
    }
}
