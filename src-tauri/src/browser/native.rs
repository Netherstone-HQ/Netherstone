//! Platform webview calls the cross-platform Tauri API doesn't cover:
//! placing a browser over its window on Linux, reading and driving
//! history, and stopping a load.

use std::sync::mpsc;
use tauri::{Runtime, Webview, webview::PlatformWebview};

#[derive(Clone, Copy)]
pub enum HistoryAction {
    Back,
    Forward,
    Stop,
}

/// Runs `f` against the platform webview on the main thread and waits for it.
fn with_platform_webview<R: Runtime, T: Send + 'static>(
    webview: &Webview<R>,
    f: impl FnOnce(PlatformWebview) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (sender, receiver) = mpsc::channel();
    webview
        .with_webview(move |platform_webview| {
            let _ = sender.send(f(platform_webview));
        })
        .map_err(|error| format!("Failed to access native browser webview: {error}"))?;

    receiver
        .recv()
        .map_err(|error| format!("Native browser webview did not respond: {error}"))?
}

pub fn history_capabilities<R: Runtime>(webview: &Webview<R>) -> Result<(bool, bool), String> {
    with_platform_webview(webview, platform::history_capabilities)
}

pub fn history_action<R: Runtime>(
    webview: &Webview<R>,
    action: HistoryAction,
) -> Result<(), String> {
    with_platform_webview(webview, move |platform_webview| {
        platform::history_action(platform_webview, action)
    })
}

/// Where a browser webview sits in its window, in physical pixels.
#[derive(Clone, Copy)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Readies a new browser webview to be placed anywhere over its window.
pub fn adopt<R: Runtime>(webview: &Webview<R>) -> Result<(), String> {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let window = webview.window();
        with_platform_webview(webview, move |platform_webview| {
            gtk_layer::adopt(&window, &platform_webview.inner())
        })
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        let _ = webview;
        Ok(())
    }
}

pub fn set_bounds<R: Runtime>(webview: &Webview<R>, bounds: Bounds) -> Result<(), String> {
    #[cfg(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ))]
    {
        let window = webview.window();
        with_platform_webview(webview, move |platform_webview| {
            gtk_layer::set_bounds(&window, &platform_webview.inner(), bounds)
        })
    }

    #[cfg(not(any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    )))]
    {
        webview
            .set_bounds(tauri::Rect {
                position: tauri::PhysicalPosition::new(bounds.x, bounds.y).into(),
                size: tauri::PhysicalSize::new(bounds.width, bounds.height).into(),
            })
            .map_err(|error| format!("Failed to place browser webview: {error}"))
    }
}

/// Tauri adds every webview of a window to the window's vertical box, where
/// GTK stacks them one above the other and wry ignores their bounds. A
/// browser webview is moved to an overlay over that box instead, where it
/// can sit anywhere above the app. Input outside it still reaches the app:
/// an overlay child only covers its own allocation.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
mod gtk_layer {
    use super::Bounds;
    use gtk::prelude::*;
    use tauri::Runtime;

    /// The overlay wrapping the window's box, added the first time a
    /// browser opens in the window.
    fn browser_layer<R: Runtime>(window: &tauri::Window<R>) -> Result<gtk::Overlay, String> {
        let vbox = window.default_vbox().map_err(|error| error.to_string())?;
        if let Some(overlay) = vbox
            .parent()
            .and_then(|parent| parent.downcast::<gtk::Overlay>().ok())
        {
            return Ok(overlay);
        }

        let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
        let overlay = gtk::Overlay::new();
        gtk_window.remove(&vbox);
        overlay.add(&vbox);
        gtk_window.add(&overlay);
        overlay.show();
        Ok(overlay)
    }

    pub fn adopt<R: Runtime>(
        window: &tauri::Window<R>,
        view: &webkit2gtk::WebView,
    ) -> Result<(), String> {
        let overlay = browser_layer(window)?;
        let parent = view.parent();
        if parent.as_ref() == Some(overlay.upcast_ref::<gtk::Widget>()) {
            return Ok(());
        }

        if let Some(container) = parent.and_then(|parent| parent.downcast::<gtk::Container>().ok())
        {
            container.remove(view);
        }
        // Placed by its margins and size request from the overlay's corner.
        view.set_halign(gtk::Align::Start);
        view.set_valign(gtk::Align::Start);
        overlay.add_overlay(view);
        Ok(())
    }

    pub fn set_bounds<R: Runtime>(
        window: &tauri::Window<R>,
        view: &webkit2gtk::WebView,
        bounds: Bounds,
    ) -> Result<(), String> {
        adopt(window, view)?;

        // GTK lays out in logical pixels at a whole-number scale.
        let scale = view.scale_factor().max(1);
        view.set_margin_start(bounds.x.max(0) / scale);
        view.set_margin_top(bounds.y.max(0) / scale);
        view.set_size_request(bounds.width as i32 / scale, bounds.height as i32 / scale);
        Ok(())
    }
}

#[cfg(windows)]
mod platform {
    use super::HistoryAction;
    use tauri::webview::PlatformWebview;
    use windows_core::BOOL;

    pub fn history_capabilities(platform_webview: PlatformWebview) -> Result<(bool, bool), String> {
        unsafe {
            let core = platform_webview
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;

            let mut can_go_back = BOOL(0);
            core.CanGoBack(&mut can_go_back as *mut BOOL)
                .map_err(|error| error.to_string())?;

            let mut can_go_forward = BOOL(0);
            core.CanGoForward(&mut can_go_forward as *mut BOOL)
                .map_err(|error| error.to_string())?;

            Ok((can_go_back.as_bool(), can_go_forward.as_bool()))
        }
    }

    pub fn history_action(
        platform_webview: PlatformWebview,
        action: HistoryAction,
    ) -> Result<(), String> {
        unsafe {
            let core = platform_webview
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;

            match action {
                HistoryAction::Back => core.GoBack(),
                HistoryAction::Forward => core.GoForward(),
                HistoryAction::Stop => core.Stop(),
            }
            .map_err(|error| error.to_string())
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::HistoryAction;
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;

    fn web_view(platform_webview: &PlatformWebview) -> &WKWebView {
        unsafe { &*platform_webview.inner().cast::<WKWebView>() }
    }

    pub fn history_capabilities(platform_webview: PlatformWebview) -> Result<(bool, bool), String> {
        let view = web_view(&platform_webview);
        unsafe { Ok((view.canGoBack(), view.canGoForward())) }
    }

    pub fn history_action(
        platform_webview: PlatformWebview,
        action: HistoryAction,
    ) -> Result<(), String> {
        let view = web_view(&platform_webview);
        unsafe {
            match action {
                HistoryAction::Back => {
                    let _ = view.goBack();
                }
                HistoryAction::Forward => {
                    let _ = view.goForward();
                }
                HistoryAction::Stop => view.stopLoading(),
            }
        }
        Ok(())
    }
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
mod platform {
    use super::HistoryAction;
    use tauri::webview::PlatformWebview;
    use webkit2gtk::WebViewExt;

    pub fn history_capabilities(platform_webview: PlatformWebview) -> Result<(bool, bool), String> {
        let view = platform_webview.inner();
        Ok((view.can_go_back(), view.can_go_forward()))
    }

    pub fn history_action(
        platform_webview: PlatformWebview,
        action: HistoryAction,
    ) -> Result<(), String> {
        let view = platform_webview.inner();
        match action {
            HistoryAction::Back => view.go_back(),
            HistoryAction::Forward => view.go_forward(),
            HistoryAction::Stop => view.stop_loading(),
        }
        Ok(())
    }
}

#[cfg(not(any(
    windows,
    target_os = "macos",
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
mod platform {
    use super::HistoryAction;
    use tauri::webview::PlatformWebview;

    pub fn history_capabilities(
        _platform_webview: PlatformWebview,
    ) -> Result<(bool, bool), String> {
        Ok((false, false))
    }

    pub fn history_action(
        _platform_webview: PlatformWebview,
        _action: HistoryAction,
    ) -> Result<(), String> {
        Err("Browser history is not supported on this platform.".to_string())
    }
}
