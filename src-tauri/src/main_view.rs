//! Keeps a window's own view at its size while the window is minimized.
//!
//! Windows reports a minimized window as resized to 0 x 0, and Tauri sizes
//! the window's view with it. The app then lays out at no size, and lays
//! out again, visibly, once restored. Without Tauri's sizing, the view
//! follows its window as the system sizes it, which skips minimizing.

use tauri::{Runtime, Webview};

/// Stops Tauri sizing `view` with its window, if it's the window's own.
pub fn take_over<R: Runtime>(view: &Webview<R>) {
    if !is_own(view.label(), view.window().label()) {
        return;
    }
    if let Err(error) = view.set_auto_resize(false) {
        eprintln!("[Netherstone] {error}");
    }
}

/// Whether a view is its window's own, not one placed in it like a page
/// in the browser panel, which the app sizes itself.
fn is_own(view: &str, window: &str) -> bool {
    view == window
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_windows_own_view_is_taken_over() {
        assert!(is_own("main", "main"));
        assert!(!is_own("browser", "main"));
    }
}
