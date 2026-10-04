//! Keeps the webview's blank first frame off screen.
//!
//! The main window is created hidden, on the splash's Ink background (see
//! tauri.conf.json). index.html puts the splash in the page, then calls
//! `show_main_window`, so the first thing on screen is the splash.

use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};

/// How long to wait for the page before showing the window anyway, so a
/// page that fails to load still leaves the user a window to close.
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

#[tauri::command]
pub fn show_main_window(window: WebviewWindow) {
    let _ = window.show();
}

pub fn show_main_window_eventually(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SHOW_FALLBACK);
        if let Some(window) = app.get_webview_window("main")
            && !window.is_visible().unwrap_or(true)
        {
            let _ = window.show();
        }
    });
}
