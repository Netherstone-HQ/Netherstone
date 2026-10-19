import { openUrl } from "@tauri-apps/plugin-opener";
import { useUIStore } from "@/store/ui";

/** An http(s) page, not one of the app's own asset or file URLs. */
export function isWebPageUrl(href: string) {
  try {
    const url = new URL(href);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "asset.localhost" &&
      url.hostname !== "file.localhost"
    );
  } catch {
    return false;
  }
}

/** Ctrl or Cmd held while clicking asks for the system browser. */
export function wantsSystemBrowser(event: {
  ctrlKey: boolean;
  metaKey: boolean;
}) {
  return event.ctrlKey || event.metaKey;
}

/**
 * Opens web pages in the browser panel, or in the system browser when asked.
 * Anything else (mailto:, tel:) goes to the system's own app.
 */
export async function openWebLink(
  href: string,
  { systemBrowser = false }: { systemBrowser?: boolean } = {},
) {
  if (systemBrowser || !isWebPageUrl(href)) {
    await openUrl(href);
    return;
  }

  useUIStore.getState().openInBrowserPanel(href);
}
