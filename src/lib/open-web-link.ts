import { openUrl } from "@tauri-apps/plugin-opener";
import { type LinkOpener, useSettingsStore } from "@/store/settings";
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

/**
 * Opens web pages where `openIn` says, or where Settings says by default.
 * Anything else (mailto:, tel:) goes to the system's own app.
 */
export async function openWebLink(
  href: string,
  openIn: LinkOpener = useSettingsStore.getState().openLinksIn,
) {
  if (openIn === "your-browser" || !isWebPageUrl(href)) {
    await openUrl(href);
    return;
  }

  useUIStore.getState().openInBrowserPanel(href);
}
