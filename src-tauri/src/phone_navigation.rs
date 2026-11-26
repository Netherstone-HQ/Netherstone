//! Keeps the phone app's view on the app's own page.
//!
//! Android's WebView here has no other windows, so a page that opens one,
//! the app's or one in an embed, would load in the app's view instead. Web
//! pages open outside the app, where links in shards open.

use tauri::Url;
#[cfg(target_os = "android")]
use tauri::{
    Emitter, Manager, Runtime,
    plugin::{Builder, TauriPlugin},
};

/// Heard by `openPagesOutside` (open-web-link.ts), with the page's URL.
#[cfg(target_os = "android")]
const OPEN_OUTSIDE_EVENT: &str = "phone-navigation:open-outside";

#[derive(Debug, PartialEq)]
enum Navigation {
    Load,
    OpenOutside,
    Refuse,
}

/// The app's own page loads (or the dev server's, in `tauri dev`), other
/// web pages open outside the app, and anything else stays where it is.
fn decide(url: &Url, dev_url: Option<&Url>) -> Navigation {
    let dev_page = dev_url.is_some_and(|dev| dev.origin() == url.origin());
    if dev_page || crate::microphone::is_app_page(url) {
        Navigation::Load
    } else if matches!(url.scheme(), "http" | "https") {
        Navigation::OpenOutside
    } else {
        Navigation::Refuse
    }
}

#[cfg(target_os = "android")]
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("phone-navigation")
        .on_navigation(|view, url| {
            let config = view.config();
            let dev_url = config.build.dev_url.as_ref().filter(|_| tauri::is_dev());
            match decide(url, dev_url) {
                Navigation::Load => true,
                Navigation::OpenOutside => {
                    if let Err(error) = view.emit(OPEN_OUTSIDE_EVENT, url.as_str()) {
                        eprintln!("[Netherstone] {error}");
                    }
                    false
                }
                Navigation::Refuse => false,
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(text: &str) -> Url {
        text.parse().unwrap()
    }

    #[test]
    fn the_app_page_loads() {
        assert_eq!(
            decide(&url("http://tauri.localhost/"), None),
            Navigation::Load
        );
        assert_eq!(
            decide(&url("http://tauri.localhost/index.html?vault=1"), None),
            Navigation::Load
        );
    }

    #[test]
    fn web_pages_open_outside_the_app() {
        for page in [
            "https://www.youtube.com/watch?v=abc",
            "http://example.com/",
            "https://tauri.localhost.example.com/",
        ] {
            assert_eq!(decide(&url(page), None), Navigation::OpenOutside, "{page}");
        }
    }

    #[test]
    fn other_addresses_stay_where_they_are() {
        for address in [
            "data:text/html,<p>page</p>",
            "blob:https://example.com/0f6b8f9e-2f63-4c1e-9d55-7a1f3c2b8e10",
            "intent://scan/#Intent;scheme=zxing;end",
            "about:blank",
            "file:///sdcard/page.html",
            "mailto:someone@example.com",
        ] {
            assert_eq!(decide(&url(address), None), Navigation::Refuse, "{address}");
        }
    }

    #[test]
    fn the_dev_server_loads_only_in_tauri_dev() {
        let dev = url("http://192.168.1.20:1420/");
        let page = url("http://192.168.1.20:1420/index.html");
        assert_eq!(decide(&page, Some(&dev)), Navigation::Load);
        assert_eq!(decide(&page, None), Navigation::OpenOutside);
        assert_eq!(
            decide(&url("http://192.168.1.20:8080/"), Some(&dev)),
            Navigation::OpenOutside
        );
    }
}
