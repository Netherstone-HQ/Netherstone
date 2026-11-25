import { openUrl } from "@tauri-apps/plugin-opener";
import { IS_ANDROID, IS_MOBILE } from "@/lib/platform";
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
 * Anything else (mailto:, tel:) goes to the system's own app. On Android the
 * browser panel is the browser's custom tab over the app; other phones have
 * none yet, so pages open in the system's browser there.
 */
export async function openWebLink(
  href: string,
  openIn: LinkOpener = useSettingsStore.getState().openLinksIn,
) {
  const inApp = openIn === "browser-panel" && isWebPageUrl(href);
  const android = IS_ANDROID ? window.NetherstoneAndroid : undefined;
  if (inApp && android) {
    android.openInApp(href);
    return;
  }
  if (!inApp || IS_MOBILE) {
    await openUrl(href);
    return;
  }

  useUIStore.getState().openInBrowserPanel(href);
}
