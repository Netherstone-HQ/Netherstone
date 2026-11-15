//! Checks GitHub Releases for a newer version and installs it.
//!
//! Each release channel has its own update file, which the release workflow
//! keeps current on the `updates` release. Beta follows every release,
//! stable only releases without a pre-release suffix.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State, Url, ipc::Channel};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

use crate::links::UPDATES as UPDATES_URL;

/// The update found by the last check, kept until it is installed, with its
/// package once downloaded.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Pending>>);

struct Pending {
    update: Update,
    package: Option<Vec<u8>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    current_version: String,
    notes: Option<String>,
}

fn channel_url(beta: bool) -> Result<Url, String> {
    let file = if beta { "beta.json" } else { "stable.json" };
    Url::parse(&format!("{UPDATES_URL}/{file}")).map_err(|e| e.to_string())
}

/// Looks for a version newer than the running one on the chosen channel.
#[tauri::command]
pub async fn updater_check(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
    beta: bool,
) -> Result<Option<AvailableUpdate>, String> {
    let update = match app
        .updater_builder()
        .endpoints(vec![channel_url(beta)?])
        .and_then(|builder| builder.build())
        .map_err(|e| e.to_string())?
        .check()
        .await
    {
        Ok(update) => update,
        // The channel has no release yet, e.g. stable before the first one.
        Err(Error::ReleaseNotFound) => None,
        Err(e) => return Err(e.to_string()),
    };

    let available = update.as_ref().map(|update| AvailableUpdate {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone(),
    });
    *pending.0.lock().unwrap() = update.map(|update| Pending {
        update,
        package: None,
    });
    Ok(available)
}

/// Whole percent of `downloaded` out of `total`, when the size is known.
fn download_percent(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|total| *total > 0)?;
    Some((downloaded.min(total) * 100 / total) as u8)
}

/// Downloads the update found by the last check, so installing it later is
/// quick. Reports progress in whole percents, each one once.
#[tauri::command]
pub async fn updater_download(
    pending: State<'_, PendingUpdate>,
    on_progress: Channel<u8>,
) -> Result<(), String> {
    let update = match pending.0.lock().unwrap().as_ref() {
        Some(Pending {
            package: Some(_), ..
        }) => return Ok(()),
        Some(Pending { update, .. }) => update.clone(),
        None => return Err("There is no update to download.".into()),
    };

    let mut downloaded = 0u64;
    let mut reported = None;
    let package = update
        .download(
            |chunk, total| {
                downloaded += chunk as u64;
                let percent = download_percent(downloaded, total);
                if let Some(percent) = percent.filter(|p| reported != Some(*p)) {
                    reported = Some(percent);
                    let _ = on_progress.send(percent);
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    // A newer check may have found another update meanwhile.
    if let Some(current) = pending.0.lock().unwrap().as_mut()
        && current.update.download_url == update.download_url
    {
        current.package = Some(package);
    }
    Ok(())
}

/// Installs the downloaded update, then restarts. On Windows the installer
/// closes the app and reopens it itself.
#[tauri::command]
pub async fn updater_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let Some(Pending {
        update,
        package: Some(package),
    }) = pending.0.lock().unwrap().take()
    else {
        return Err("The update hasn't finished downloading.".into());
    };

    update.install(package).map_err(|e| e.to_string())?;

    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_percent_needs_a_known_size() {
        assert_eq!(download_percent(10, None), None);
        assert_eq!(download_percent(10, Some(0)), None);
        assert_eq!(download_percent(0, Some(200)), Some(0));
        assert_eq!(download_percent(199, Some(200)), Some(99));
        assert_eq!(download_percent(300, Some(200)), Some(100));
    }

    #[test]
    fn channels_use_their_own_update_file() {
        assert_eq!(
            channel_url(false).unwrap().as_str(),
            "https://github.com/Netherstone-HQ/Netherstone/releases/download/updates/stable.json"
        );
        assert_eq!(
            channel_url(true).unwrap().as_str(),
            "https://github.com/Netherstone-HQ/Netherstone/releases/download/updates/beta.json"
        );
    }
}
