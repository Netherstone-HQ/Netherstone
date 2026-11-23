//! Keeps the webview's blank first frame off screen.
//!
//! The main window is created hidden, on the splash's Ink background (see
//! tauri.conf.json). index.html puts the splash in the page, then calls
//! `show_main_window`, so the first thing on screen is the splash.

#[cfg(desktop)]
use std::time::Duration;
use tauri::WebviewWindow;
#[cfg(desktop)]
use tauri::{AppHandle, Manager};

/// How long to wait for the page before showing the window anyway, so a
/// page that fails to load still leaves the user a window to close.
#[cfg(desktop)]
const SHOW_FALLBACK: Duration = Duration::from_secs(3);

/// Phones show the app's one window from the start.
#[tauri::command]
pub fn show_main_window(window: WebviewWindow) {
    #[cfg(desktop)]
    let _ = window.show();
    #[cfg(mobile)]
    let _ = window;
}

#[cfg(desktop)]
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
