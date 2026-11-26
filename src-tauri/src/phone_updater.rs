//! Updates for the Android app from GitHub, with updater.rs's commands. The
//! channel file lists each APK and its SHA-256 (scripts/updater-json.mjs);
//! MainActivity.kt hands the download to the installer.

use serde::Deserialize;
use std::collections::HashMap;

/// An APK newer than the app: its version, where it is and its SHA-256.
#[derive(Debug, Clone, PartialEq)]
struct Found {
    version: String,
    url: String,
    sha256: String,
}

/// A channel file, as scripts/updater-json.mjs writes it: only what a phone
/// reads. `android` lists each APK by architecture.
#[derive(Debug, Deserialize)]
struct ChannelFile {
    version: String,
    #[serde(default)]
    android: HashMap<String, Apk>,
}

#[derive(Debug, Deserialize)]
struct Apk {
    url: String,
    sha256: String,
}

/// The APK for `arch` in `channel` when its version is newer than `current`.
fn newer_apk(channel: &ChannelFile, arch: &str, current: &str) -> Option<Found> {
    let newer =
        semver::Version::parse(&channel.version).ok()? > semver::Version::parse(current).ok()?;
    if !newer {
        return None;
    }
    let apk = channel.android.get(arch)?;
    Some(Found {
        version: channel.version.clone(),
        url: apk.url.clone(),
        sha256: apk.sha256.to_lowercase(),
    })
}

/// Whether a downloaded APK of version `downloaded` is spent for the app at
/// `current`: installed by now, older, or of unknown version.
fn is_spent(downloaded: Option<&str>, current: &str) -> bool {
    let version = |text: &str| semver::Version::parse(text.trim()).ok();
    match (downloaded.and_then(version), version(current)) {
        (Some(downloaded), Some(current)) => downloaded <= current,
        _ => true,
    }
}

/// Whole percent of `downloaded` out of `total`, when the size is known.
fn download_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|total| *total > 0)?;
    Some((downloaded.min(total) * 100 / total) as u8)
}

/// The commands, on the phone only: everything above is plain and tested
/// on any computer.
#[cfg(target_os = "android")]
mod commands {
    use super::*;
    use crate::links::UPDATES as UPDATES_URL;
    use serde::Serialize;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::{AppHandle, Manager, State, ipc::Channel};

    /// Where the downloaded APK waits for the installer, in the app's
    /// cache. MainActivity.kt installs only this file.
    const UPDATE_FOLDER: &str = "updates";
    const UPDATE_FILE: &str = "Netherstone.apk";
    /// Beside the APK: its version, so a later start can tell an installed
    /// update from one still waiting.
    const VERSION_FILE: &str = "version";
    /// How long connecting to GitHub may take before giving up.
    const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);

    /// The update found by the last check, kept until it's downloaded.
    #[derive(Default)]
    pub struct PendingUpdate(Mutex<Option<Found>>);

    #[derive(Debug, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct AvailableUpdate {
        version: String,
        current_version: String,
        notes: Option<String>,
    }

    fn client() -> Result<reqwest::Client, String> {
        reqwest::Client::builder()
            .user_agent(concat!("Netherstone/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|e| e.to_string())
    }

    fn update_file(app: &AppHandle) -> Result<PathBuf, String> {
        Ok(app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join(UPDATE_FOLDER)
            .join(UPDATE_FILE))
    }

    /// Looks for a version newer than the running one on the chosen channel.
    #[tauri::command]
    pub async fn updater_check(
        app: AppHandle,
        pending: State<'_, PendingUpdate>,
        beta: bool,
    ) -> Result<Option<AvailableUpdate>, String> {
        let file = if beta { "beta.json" } else { "stable.json" };
        let response = client()?
            .get(format!("{UPDATES_URL}/{file}"))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        // The channel has no release yet, e.g. stable before the first one.
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let channel: ChannelFile = response
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        let current = app.package_info().version.to_string();
        let found = newer_apk(&channel, std::env::consts::ARCH, &current);
        let available = found.as_ref().map(|found| AvailableUpdate {
            version: found.version.clone(),
            current_version: current,
            notes: None,
        });
        *pending.0.lock().unwrap_or_else(|e| e.into_inner()) = found;
        Ok(available)
    }

    /// Downloads the APK found by the last check into the cache, checking
    /// its SHA-256. Reports progress in whole percents, each one once.
    #[tauri::command]
    pub async fn updater_download(
        app: AppHandle,
        pending: State<'_, PendingUpdate>,
        on_progress: Channel<u8>,
    ) -> Result<(), String> {
        let found = pending
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
            .ok_or("There is no update to download.")?;
        let path = update_file(&app)?;
        let folder = path.parent().ok_or("The update has nowhere to go.")?;
        std::fs::create_dir_all(folder).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(folder.join(VERSION_FILE));

        let mut response = client()?
            .get(&found.url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|e| e.to_string())?;
        let total = response.content_length();
        let part = path.with_extension("part");
        let mut out = std::fs::File::create(&part).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut downloaded = 0u64;
        let mut reported = None;
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            out.write_all(&chunk).map_err(|e| e.to_string())?;
            hasher.update(&chunk);
            downloaded += chunk.len() as u64;
            let percent = download_percent(downloaded, total);
            if let Some(percent) = percent.filter(|p| reported != Some(*p)) {
                reported = Some(percent);
                let _ = on_progress.send(percent);
            }
        }
        drop(out);
        let digest: String = hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        if digest != found.sha256 {
            let _ = std::fs::remove_file(&part);
            return Err("The update didn't download whole. Try again.".into());
        }
        std::fs::rename(&part, &path).map_err(|e| e.to_string())?;
        let _ = std::fs::write(folder.join(VERSION_FILE), &found.version);
        Ok(())
    }

    /// Removes a downloaded APK once it's installed, so it doesn't sit in the
    /// cache until the next update. One still waiting to be installed stays.
    pub fn remove_spent_download(app: &AppHandle) {
        let Ok(file) = update_file(app) else { return };
        let Some(folder) = file.parent() else { return };
        let downloaded = std::fs::read_to_string(folder.join(VERSION_FILE)).ok();
        let current = app.package_info().version.to_string();
        if is_spent(downloaded.as_deref(), &current) {
            let _ = std::fs::remove_dir_all(folder);
        }
    }

    /// The window hands the downloaded APK to the installer itself
    /// (MainActivity.kt), so this only checks it's there.
    #[tauri::command]
    pub async fn updater_install(app: AppHandle) -> Result<(), String> {
        if update_file(&app)?.is_file() {
            Ok(())
        } else {
            Err("The update hasn't finished downloading.".into())
        }
    }
}

#[cfg(target_os = "android")]
pub use commands::*;

#[cfg(test)]
mod tests {
    use super::*;

    fn channel(version: &str) -> ChannelFile {
        serde_json::from_str(&format!(
            r#"{{"version":"{version}","notes":"",
                "platforms":{{"windows-x86_64":{{"url":"https://example.com/w.exe","signature":"s"}}}},
                "android":{{"aarch64":{{"url":"https://example.com/a.apk","sha256":"ABC"}}}}}}"#
        ))
        .unwrap()
    }

    #[test]
    fn finds_a_newer_apk_for_this_phone() {
        assert_eq!(
            newer_apk(&channel("0.8.0"), "aarch64", "0.7.0-beta.3"),
            Some(Found {
                version: "0.8.0".into(),
                url: "https://example.com/a.apk".into(),
                sha256: "abc".into(),
            })
        );
    }

    #[test]
    fn leaves_the_same_or_an_older_version_and_other_phones_alone() {
        assert_eq!(
            newer_apk(&channel("0.7.0-beta.3"), "aarch64", "0.7.0-beta.3"),
            None
        );
        assert_eq!(
            newer_apk(&channel("0.6.0"), "aarch64", "0.7.0-beta.3"),
            None
        );
        assert_eq!(newer_apk(&channel("0.8.0"), "x86_64", "0.7.0-beta.3"), None);
    }

    #[test]
    fn a_download_is_spent_once_the_app_is_as_new() {
        assert!(is_spent(Some("0.8.0"), "0.8.0"));
        assert!(is_spent(Some("0.8.0-beta.1"), "0.8.0"));
        assert!(is_spent(None, "0.8.0"));
        assert!(!is_spent(Some("0.8.1"), "0.8.0"));
    }

    #[test]
    fn counts_whole_percents() {
        assert_eq!(download_percent(50, Some(200)), Some(25));
        assert_eq!(download_percent(50, None), None);
    }
}
