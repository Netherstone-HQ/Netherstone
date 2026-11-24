// Attaching Playwright to the app's WebView on an Android device, shared by
// the emulator checks (android-ui-check.mjs, android-editor-check.mjs).

import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";

/** Where the app's own page is served from inside its WebView. */
const APP_ORIGIN = "http://tauri.localhost";

const adb = (...args) => execFileSync("adb", args, { encoding: "utf8" }).trim();

/**
 * Waits until the WebView of process `pid` shows the app's page, as its
 * DevTools socket lists it. Attaching while the page is still blank, with
 * the app's worker starting, can leave Playwright waiting for the page
 * forever (seen in 4 of 30 restarts; none in 50 after waiting for this).
 * The wait has expect's limit.
 */
async function appPageLoaded(pid) {
  const port = adb("forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`);
  const shown = async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`)
      .then((response) => response.json())
      .catch(() => []);
    return targets.some((target) => target.type === "page" && target.url.startsWith(APP_ORIGIN));
  };
  try {
    await expect.poll(shown, { message: "the app's page to load" }).toBe(true);
  } finally {
    adb("forward", "--remove", `tcp:${port}`);
  }
}

/**
 * Starts the app (`pkg`, activity `activity`) on `device` and attaches to its
 * page. `shell` runs a device command; `within` limits a wait.
 */
export async function startAndAttach({ device, pkg, activity, shell, within }) {
  await shell(`am start -W -n ${activity}`);
  await appPageLoaded(await shell(`pidof ${pkg}`));
  const webView = await device.webView({ pkg });
  // Playwright sets no limit on attaching to the page, so this sets one.
  const page = await within(webView.page(), "the app's page to attach");
  return { webView, page };
}
