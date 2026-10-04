//! Checks GitHub Releases for a newer version and installs it.
//!
//! Each release channel has its own update file, which the release workflow
//! keeps current on the `updates` release. Beta follows every release,
//! stable only releases without a pre-release suffix.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, State, Url};
use tauri_plugin_updater::{Error, Update, UpdaterExt};

const UPDATES_URL: &str = "https://github.com/Netherstone-HQ/Netherstone/releases/download/updates";

/// The update found by the last check, kept until it is installed.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

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
    *pending.0.lock().unwrap() = update;
    Ok(available)
}

/// Downloads and installs the update found by the last check, then restarts.
/// On Windows the installer closes the app and reopens it itself.
#[tauri::command]
pub async fn updater_install(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .unwrap()
        .take()
        .ok_or("There is no update to install.")?;

    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

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
