//! Sizes a window's own view with the window, but never to nothing.
//!
//! Windows reports a minimized window as resized to 0 x 0, and Tauri sized
//! the window's view with it. The app then laid out at no size, and laid
//! out again, visibly, once restored. The view is sized here instead, as
//! Tauri sized it, skipping a size of nothing.

use tauri::{LogicalPosition, Manager, PhysicalSize, Rect, Runtime, Webview, Window};

/// Stops Tauri sizing `view` with its window, if it's the window's own,
/// so `fit` does.
pub fn take_over<R: Runtime>(view: &Webview<R>) {
    if !is_own(view.label(), view.window().label()) {
        return;
    }
    if let Err(error) = view.set_auto_resize(false) {
        eprintln!("[Netherstone] {error}");
    }
}

/// Sizes `window`'s own view to the window's new `size`, unless that's
/// nothing, as for a minimized window.
pub fn fit<R: Runtime>(window: &Window<R>, size: PhysicalSize<u32>) {
    let Some(view) = window.get_webview(window.label()) else {
        return;
    };
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let Some(bounds) = view_bounds(size, scale) else {
        return;
    };
    if let Err(error) = view.set_bounds(bounds) {
        eprintln!("[Netherstone] {error}");
    }
}

/// Where a window's own view goes in a window of `size`: all of it, in
/// logical pixels as Tauri placed it. None for a window of no size.
fn view_bounds(size: PhysicalSize<u32>, scale: f64) -> Option<Rect> {
    if size.width == 0 || size.height == 0 {
        return None;
    }
    Some(Rect {
        position: LogicalPosition::new(0.0, 0.0).into(),
        size: size.to_logical::<f64>(scale).into(),
    })
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

    /// The view's size in logical pixels, as Tauri sets it.
    fn size_of(bounds: Rect) -> (f64, f64) {
        let size = bounds.size.to_logical::<f64>(1.0);
        (size.width, size.height)
    }

    #[test]
    fn the_view_fills_the_window_at_any_size_and_scale() {
        // Restored down, maximized at 150%, resized by hand, and moved to a
        // screen at 200%.
        for (width, height, scale) in [
            (1200, 700, 1.0),
            (2560, 1392, 1.5),
            (913, 517, 1.0),
            (1800, 1050, 2.0),
        ] {
            let bounds = view_bounds(PhysicalSize::new(width, height), scale).unwrap();
            assert_eq!(
                size_of(bounds),
                (f64::from(width) / scale, f64::from(height) / scale)
            );
            let position = bounds.position.to_logical::<f64>(scale);
            assert_eq!((position.x, position.y), (0.0, 0.0));
        }
    }

    #[test]
    fn a_minimized_window_leaves_its_view_as_it_was() {
        assert!(view_bounds(PhysicalSize::new(0, 0), 1.0).is_none());
        assert!(view_bounds(PhysicalSize::new(1200, 0), 1.0).is_none());
    }
}
