import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_BROWSER_WEBVIEW_LABEL = "netherstone-browser-panel";
export const CANVAS_BROWSER_WEBVIEW_LABEL = "netherstone-canvas-browser-panel";
export const BROWSER_STATE_EVENT = "browser:state";
export const LIBRARY_RETURN_EVENT = "browser:library-return";

export interface BrowserStateSnapshot {
  label: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

/**
 * Where the browser sits in the window, in physical pixels: whole device
 * pixels, so each edge lands exactly where the panel's edge is drawn.
 */
export interface BrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LibraryReturnPayload {
  label: string;
  url: string;
}

export function resetBrowserWebviewState(
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<BrowserStateSnapshot>("browser_reset_state", { label });
}

export function getBrowserWebviewState(
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<BrowserStateSnapshot>("browser_get_state", { label });
}

export function navigateBrowserWebview(
  url: string,
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<void>("browser_navigate", { url, label });
}

export function reloadBrowserWebview(
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<void>("browser_reload", { label });
}

export function stopBrowserWebviewLoading(
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<void>("browser_stop_loading", { label });
}

export function goBackBrowserWebview(
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<void>("browser_go_back", { label });
}

export function goForwardBrowserWebview(
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<void>("browser_go_forward", { label });
}

/** `seq` must grow with each call; an older placement arriving late is dropped. */
export function setBrowserWebviewBounds(
  bounds: BrowserBounds,
  seq: number,
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<void>("browser_set_bounds", { bounds, seq, label });
}

export function setBrowserWebviewVisible(
  visible: boolean,
  label: string = DEFAULT_BROWSER_WEBVIEW_LABEL,
) {
  return invoke<void>("browser_set_visible", { visible, label });
}
