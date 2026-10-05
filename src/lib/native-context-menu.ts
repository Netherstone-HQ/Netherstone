// WebView's own right-click menu (Back, Refresh, Save as, Print) belongs to a
// web page, not an app. Text keeps it: there it carries spellcheck
// suggestions and cut, copy and paste.

const EDITABLE_SELECTOR =
  'input, textarea, [contenteditable=""], [contenteditable="true"]';

function keepsNativeMenu(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (target.closest(EDITABLE_SELECTOR)) return true;

  // Selected text can still be copied from anywhere.
  const selection = document.getSelection();
  return Boolean(selection && !selection.isCollapsed);
}

function onContextMenu(event: MouseEvent) {
  // Menus of our own have already handled it.
  if (event.defaultPrevented) return;
  if (keepsNativeMenu(event.target)) return;
  event.preventDefault();
}

/** Hides the webview's page menu everywhere but text. */
export function suppressNativeContextMenu() {
  window.addEventListener("contextmenu", onContextMenu);
  return () => window.removeEventListener("contextmenu", onContextMenu);
}
