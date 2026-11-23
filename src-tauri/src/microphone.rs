//! Microphone access for voice notes. Only the app's own page in a
//! window's own view may record. Pages in the browser panel, and anything
//! else, never get the microphone or camera.

use tauri::webview::{PermissionKind, PermissionResponse};
use tauri::{Runtime, Url, Webview};

/// Answers a webview's request for a device or permission.
pub fn answer<R: Runtime>(view: Webview<R>, kind: PermissionKind) -> PermissionResponse {
    let own = view.label() == view.window().label();
    // On Android this runs on the UI thread, and `url()` waits for that same
    // thread: the app would hang, then abort. The page each view last started
    // loading is kept instead.
    #[cfg(mobile)]
    let app_page = PAGES.is_app_page(view.label());
    #[cfg(desktop)]
    let app_page = view.url().is_ok_and(|url| is_app_page(&url));
    decide(kind, own, app_page)
}

/// Keeps the page `view` started loading, for `answer` on phones.
#[cfg(mobile)]
pub fn page_started<R: Runtime>(view: &Webview<R>, url: &Url) {
    PAGES.started(view.label(), url);
}

#[cfg(mobile)]
static PAGES: Pages = Pages::new();

/// The page each view last started loading, by view label.
#[cfg(any(mobile, test))]
struct Pages(std::sync::Mutex<std::collections::BTreeMap<String, Url>>);

#[cfg(any(mobile, test))]
impl Pages {
    const fn new() -> Self {
        Self(std::sync::Mutex::new(std::collections::BTreeMap::new()))
    }

    fn started(&self, label: &str, url: &Url) {
        let mut pages = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pages.insert(label.to_string(), url.clone());
    }

    fn is_app_page(&self, label: &str) -> bool {
        let pages = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pages.get(label).is_some_and(is_app_page)
    }
}

fn decide(kind: PermissionKind, own_view: bool, app_page: bool) -> PermissionResponse {
    match kind {
        PermissionKind::Microphone if own_view && app_page => PermissionResponse::Allow,
        PermissionKind::Microphone | PermissionKind::Camera | PermissionKind::DisplayCapture => {
            PermissionResponse::Deny
        }
        _ => PermissionResponse::Default,
    }
}

/// Whether `url` is the app's own page: the dev server in a debug build,
/// else the bundled page under its custom protocol.
fn is_app_page(url: &Url) -> bool {
    if cfg!(debug_assertions) && url.scheme() == "http" && url.host_str() == Some("localhost") {
        return true;
    }
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => url.host_str() == Some("tauri.localhost"),
        _ => false,
    }
}

/// WebKitGTK keeps `getUserMedia` off unless the page's settings turn it on.
#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
pub fn enable_capture<R: Runtime>(view: &Webview<R>) {
    use webkit2gtk::{SettingsExt, WebViewExt};
    let result = view.with_webview(|platform| {
        if let Some(settings) = WebViewExt::settings(&platform.inner()) {
            settings.set_enable_media_stream(true);
        }
    });
    if let Err(error) = result {
        eprintln!("[Netherstone] {error}");
    }
}

#[cfg(not(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
pub fn enable_capture<R: Runtime>(_view: &Webview<R>) {}

/// The system's microphone privacy page, where it has one.
fn settings_page() -> Option<&'static str> {
    if cfg!(target_os = "windows") {
        Some(crate::links::MICROPHONE_SETTINGS_WINDOWS)
    } else if cfg!(target_os = "macos") {
        Some(crate::links::MICROPHONE_SETTINGS_MACOS)
    } else {
        None
    }
}

/// Whether this system has a page to turn microphone access on.
#[tauri::command]
pub fn microphone_settings_available() -> bool {
    settings_page().is_some()
}

/// Opens the system's microphone privacy page.
#[tauri::command(async)]
pub fn open_microphone_settings() -> Result<(), String> {
    let page = settings_page().ok_or("This system has no microphone settings page.")?;
    tauri_plugin_opener::open_url(page, None::<&str>).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        text.parse().unwrap()
    }

    #[test]
    fn only_the_app_page_in_its_own_view_gets_the_microphone() {
        let allowed = |own, page| decide(PermissionKind::Microphone, own, page);
        assert_eq!(allowed(true, true), PermissionResponse::Allow);
        assert_eq!(allowed(false, true), PermissionResponse::Deny);
        assert_eq!(allowed(true, false), PermissionResponse::Deny);
        assert_eq!(allowed(false, false), PermissionResponse::Deny);
    }

    #[test]
    fn camera_and_screen_are_never_given() {
        for kind in [PermissionKind::Camera, PermissionKind::DisplayCapture] {
            assert_eq!(decide(kind, true, true), PermissionResponse::Deny);
        }
    }

    #[test]
    fn the_bundled_page_is_the_app_and_websites_are_not() {
        assert!(is_app_page(&url("tauri://localhost/")));
        assert!(is_app_page(&url("http://tauri.localhost/index.html")));
        assert!(is_app_page(&url("https://tauri.localhost/")));
        assert!(!is_app_page(&url("https://example.com/")));
        assert!(!is_app_page(&url("https://tauri.localhost.example.com/")));
        assert!(!is_app_page(&url("netherstone-pdf://localhost/")));
    }

    #[test]
    fn a_view_is_judged_by_the_page_it_last_started_loading() {
        let pages = Pages::new();
        assert!(!pages.is_app_page("main"));
        pages.started("main", &url("http://tauri.localhost/"));
        assert!(pages.is_app_page("main"));
        pages.started("main", &url("https://example.com/"));
        assert!(!pages.is_app_page("main"));
        assert!(!pages.is_app_page("other"));
    }
}
