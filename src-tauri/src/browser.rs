mod native;

use native::HistoryAction;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    Emitter, Manager, Runtime,
    plugin::{Builder as PluginBuilder, TauriPlugin},
};

pub const DEFAULT_BROWSER_WEBVIEW_LABEL: &str = "netherstone-browser-panel";
pub const CANVAS_BROWSER_WEBVIEW_LABEL: &str = "netherstone-canvas-browser-panel";
pub const BROWSER_STATE_EVENT: &str = "browser:state";
pub const LIBRARY_RETURN_EVENT: &str = "browser:library-return";
const MAIN_WEBVIEW_LABEL: &str = "main";

#[derive(Default)]
pub struct BrowserState(Mutex<HashMap<String, BrowserStateInner>>);

#[derive(Default, Clone)]
struct BrowserStateInner {
    current_url: Option<String>,
    is_loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
    /// The newest placement applied, by the number the panel gave it.
    last_bounds_seq: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStateSnapshot {
    label: String,
    url: String,
    is_loading: bool,
    can_go_back: bool,
    can_go_forward: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryReturn {
    label: String,
    url: String,
}

/// Where the browser sits in the window, in physical pixels. The panel
/// rounds the edges itself; converting a logical position and size
/// separately would round each on its own and make the edges wobble.
#[derive(Deserialize)]
pub struct BrowserBounds {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl BrowserState {
    fn snapshot_from_inner(label: &str, inner: &BrowserStateInner) -> BrowserStateSnapshot {
        BrowserStateSnapshot {
            label: label.to_string(),
            url: inner.current_url.clone().unwrap_or_default(),
            is_loading: inner.is_loading,
            can_go_back: inner.can_go_back,
            can_go_forward: inner.can_go_forward,
        }
    }

    pub fn snapshot(&self, label: &str) -> BrowserStateSnapshot {
        let inner = self.0.lock().unwrap();
        let state = inner.get(label).cloned().unwrap_or_default();
        Self::snapshot_from_inner(label, &state)
    }

    pub fn reset(&self, label: &str) -> BrowserStateSnapshot {
        let mut inner = self.0.lock().unwrap();
        inner.insert(label.to_string(), BrowserStateInner::default());
        let state = inner.get(label).cloned().unwrap_or_default();
        Self::snapshot_from_inner(label, &state)
    }

    pub fn apply_navigation(&self, label: &str, url: String) -> BrowserStateSnapshot {
        let mut inner = self.0.lock().unwrap();
        let state = inner.entry(label.to_string()).or_default();
        state.current_url = Some(url);
        state.is_loading = true;
        Self::snapshot_from_inner(label, state)
    }

    pub fn apply_page_load(
        &self,
        label: &str,
        url: String,
        is_loading: bool,
    ) -> BrowserStateSnapshot {
        let mut inner = self.0.lock().unwrap();
        let state = inner.entry(label.to_string()).or_default();
        state.current_url = Some(url);
        state.is_loading = is_loading;
        Self::snapshot_from_inner(label, state)
    }

    /// Placements are sent without waiting for each other, so one can
    /// arrive after a newer one. Only the newest is applied.
    pub fn accept_bounds_seq(&self, label: &str, seq: u64) -> bool {
        let mut inner = self.0.lock().unwrap();
        let state = inner.entry(label.to_string()).or_default();
        if seq <= state.last_bounds_seq {
            return false;
        }
        state.last_bounds_seq = seq;
        true
    }

    pub fn apply_capabilities(
        &self,
        label: &str,
        can_go_back: bool,
        can_go_forward: bool,
    ) -> BrowserStateSnapshot {
        let mut inner = self.0.lock().unwrap();
        let state = inner.entry(label.to_string()).or_default();
        state.can_go_back = can_go_back;
        state.can_go_forward = can_go_forward;
        Self::snapshot_from_inner(label, state)
    }
}

fn get_browser_webview<R: Runtime>(
    app: &tauri::AppHandle<R>,
    label: &str,
) -> Result<tauri::Webview<R>, String> {
    app.get_webview(label)
        .ok_or_else(|| format!("Browser webview `{label}` is not available."))
}

fn emit_browser_state<R: Runtime>(app: &tauri::AppHandle<R>, state: BrowserStateSnapshot) {
    let _ = app.emit(BROWSER_STATE_EVENT, state);
}

fn is_browser_label(label: &str) -> bool {
    label == DEFAULT_BROWSER_WEBVIEW_LABEL || label == CANVAS_BROWSER_WEBVIEW_LABEL
}

fn refresh_browser_capabilities<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &BrowserState,
    label: &str,
) -> Result<BrowserStateSnapshot, String> {
    let webview = get_browser_webview(app, label)?;
    let (can_go_back, can_go_forward) = native::history_capabilities(&webview)?;
    Ok(state.apply_capabilities(label, can_go_back, can_go_forward))
}

fn refresh_and_emit_browser_state<R: Runtime>(app: &tauri::AppHandle<R>, label: &str) {
    let browser_state = app.state::<BrowserState>();
    if let Ok(snapshot) = refresh_browser_capabilities(app, &browser_state, label) {
        emit_browser_state(app, snapshot);
    }
}

/// The Excalidraw library site sends its picks back by navigating to the
/// app's own page with `#addLibrary=…`. That page must not load inside the
/// browser, so the navigation is stopped and its URL handed to the canvas.
fn is_library_return_url<R: Runtime>(app: &tauri::AppHandle<R>, url: &tauri::Url) -> bool {
    let has_library_hash = url
        .fragment()
        .is_some_and(|fragment| fragment.contains("addLibrary="));
    if !has_library_hash {
        return false;
    }

    // Compared by parts: `Url::origin` is opaque, and never equal, for
    // custom schemes such as the production `tauri://localhost`.
    app.get_webview(MAIN_WEBVIEW_LABEL)
        .and_then(|main| main.url().ok())
        .is_some_and(|app_url| {
            app_url.scheme() == url.scheme()
                && app_url.host_str() == url.host_str()
                && app_url.port_or_known_default() == url.port_or_known_default()
        })
}

fn install_library_link_handler<R: Runtime>(webview: &tauri::Webview<R>) {
    let script = r##"
(() => {
  if (window.__netherstoneLibraryLinkHandlerInstalled) return;
  window.__netherstoneLibraryLinkHandlerInstalled = true;

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest('a.install-library[href], a[href*="#addLibrary="]');
      if (!(link instanceof HTMLAnchorElement)) return;

      event.preventDefault();
      event.stopPropagation();
      window.location.assign(link.href);
    },
    true,
  );
})();
"##;

    let _ = webview.eval(script);
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    PluginBuilder::new("browser")
        .on_webview_ready(|webview| {
            if is_browser_label(webview.label())
                && let Err(error) = native::adopt(&webview)
            {
                eprintln!("[Netherstone] Failed to set up the browser webview: {error}");
            }
        })
        .on_navigation(|webview, url| {
            let label = webview.label().to_string();
            if is_browser_label(&label) {
                let window = webview.window();
                let app = window.app_handle();

                if label == CANVAS_BROWSER_WEBVIEW_LABEL && is_library_return_url(app, url) {
                    let _ = app.emit(
                        LIBRARY_RETURN_EVENT,
                        LibraryReturn {
                            label,
                            url: url.to_string(),
                        },
                    );
                    return false;
                }

                let browser_state = app.state::<BrowserState>();
                let snapshot = browser_state.apply_navigation(&label, url.to_string());
                emit_browser_state(app, snapshot);
                refresh_and_emit_browser_state(app, &label);
            }

            true
        })
        .on_page_load(|webview, payload| {
            let label = webview.label().to_string();
            if is_browser_label(&label) {
                let window = webview.window();
                let app = window.app_handle();
                let is_finished =
                    matches!(payload.event(), tauri::webview::PageLoadEvent::Finished);
                let browser_state = app.state::<BrowserState>();
                let snapshot =
                    browser_state.apply_page_load(&label, payload.url().to_string(), !is_finished);
                emit_browser_state(app, snapshot);
                refresh_and_emit_browser_state(app, &label);

                if is_finished && label == CANVAS_BROWSER_WEBVIEW_LABEL {
                    install_library_link_handler(webview);
                }
            }
        })
        .build()
}

#[tauri::command]
pub fn browser_reset_state(
    state: tauri::State<BrowserState>,
    label: Option<String>,
) -> BrowserStateSnapshot {
    let label = label.unwrap_or_else(|| DEFAULT_BROWSER_WEBVIEW_LABEL.to_string());
    state.reset(&label)
}

#[tauri::command]
pub fn browser_get_state(
    app: tauri::AppHandle,
    state: tauri::State<BrowserState>,
    label: Option<String>,
) -> BrowserStateSnapshot {
    let label = label.unwrap_or_else(|| DEFAULT_BROWSER_WEBVIEW_LABEL.to_string());
    refresh_browser_capabilities(&app, &state, &label).unwrap_or_else(|_| state.snapshot(&label))
}

#[tauri::command]
pub fn browser_navigate(
    app: tauri::AppHandle,
    url: String,
    label: Option<String>,
) -> Result<(), String> {
    let label = label.unwrap_or_else(|| DEFAULT_BROWSER_WEBVIEW_LABEL.to_string());
    let parsed_url = tauri::Url::parse(&url).map_err(|error| format!("Invalid URL: {error}"))?;
    let webview = get_browser_webview(&app, &label)?;

    webview
        .navigate(parsed_url)
        .map_err(|error| format!("Failed to navigate browser webview: {error}"))
}

#[tauri::command]
pub fn browser_reload(app: tauri::AppHandle, label: Option<String>) -> Result<(), String> {
    let label = label.unwrap_or_else(|| DEFAULT_BROWSER_WEBVIEW_LABEL.to_string());
    let webview = get_browser_webview(&app, &label)?;

    webview
        .reload()
        .map_err(|error| format!("Failed to reload browser webview: {error}"))
}

#[tauri::command]
pub fn browser_stop_loading(app: tauri::AppHandle, label: Option<String>) -> Result<(), String> {
    browser_history_action(app, label, HistoryAction::Stop)
}

#[tauri::command]
pub fn browser_go_back(app: tauri::AppHandle, label: Option<String>) -> Result<(), String> {
    browser_history_action(app, label, HistoryAction::Back)
}

#[tauri::command]
pub fn browser_go_forward(app: tauri::AppHandle, label: Option<String>) -> Result<(), String> {
    browser_history_action(app, label, HistoryAction::Forward)
}

fn browser_history_action(
    app: tauri::AppHandle,
    label: Option<String>,
    action: HistoryAction,
) -> Result<(), String> {
    let label = label.unwrap_or_else(|| DEFAULT_BROWSER_WEBVIEW_LABEL.to_string());
    let webview = get_browser_webview(&app, &label)?;
    native::history_action(&webview, action)
}

/// Moves and resizes the browser in one call, so position and size can't
/// land on different frames.
#[tauri::command]
pub fn browser_set_bounds(
    app: tauri::AppHandle,
    state: tauri::State<BrowserState>,
    bounds: BrowserBounds,
    seq: u64,
    label: Option<String>,
) -> Result<(), String> {
    let label = label.unwrap_or_else(|| DEFAULT_BROWSER_WEBVIEW_LABEL.to_string());
    if !state.accept_bounds_seq(&label, seq) {
        return Ok(());
    }
    let webview = get_browser_webview(&app, &label)?;

    native::set_bounds(
        &webview,
        native::Bounds {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
        },
    )
}

#[tauri::command]
pub fn browser_set_visible(
    app: tauri::AppHandle,
    visible: bool,
    label: Option<String>,
) -> Result<(), String> {
    let label = label.unwrap_or_else(|| DEFAULT_BROWSER_WEBVIEW_LABEL.to_string());
    let webview = get_browser_webview(&app, &label)?;

    if visible {
        webview.show()
    } else {
        webview.hide()
    }
    .map_err(|error| format!("Failed to change browser webview visibility: {error}"))
}
