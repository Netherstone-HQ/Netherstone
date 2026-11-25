// What the emulator checks (android-ui-check.mjs, android-editor-check.mjs)
// share: the device, limited waits, and attaching Playwright to the app's
// WebView.

import { execFileSync } from "node:child_process";
import { _android as android, expect as baseExpect } from "@playwright/test";

export const PACKAGE = "tech.blueblood.netherstone";
export const ACTIVITY = `${PACKAGE}/.MainActivity`;

/**
 * How long one wait may take. Far above any step on a CI emulator, so only
 * a stuck step reaches it.
 */
export const WAIT_LIMIT_MS = Number(process.env.WAIT_LIMIT_MS ?? 60_000);

// configure returns a new expect; the imported one keeps its 5 s limit.
export const expect = baseExpect.configure({ timeout: WAIT_LIMIT_MS });

export const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);

/** Runs adb on the computer, failing with what it said. */
export function adb(...args) {
  try {
    return execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 << 20, timeout: WAIT_LIMIT_MS }).trim();
  } catch (error) {
    throw new Error(`adb ${args.join(" ")} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

/** Waits for `promise`, failing once the wait limit has passed. */
export async function within(promise, what) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Waited ${WAIT_LIMIT_MS} ms for ${what}`)), WAIT_LIMIT_MS);
  });
  try {
    return await Promise.race([promise, limit]);
  } finally {
    clearTimeout(timer);
  }
}

/** The connected device, and `shell` to run a command on it. */
export async function connectDevice() {
  const [device] = await android.devices({ omitDriverInstall: true });
  if (!device) throw new Error("No Android device or emulator is connected");
  device.setDefaultTimeout(WAIT_LIMIT_MS);
  const shell = async (command) =>
    (await within(device.shell(command), `adb shell ${command}`)).toString().trim();
  return { device, shell };
}

/** Where the app's own page is served from inside its WebView. */
const APP_ORIGIN = "http://tauri.localhost";

/** The origin of `url`, or null when it isn't one. */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * How long one look at the page list may take. Through `adb forward`, a
 * socket the WebView hasn't opened yet takes the connection and never
 * answers, so a look that takes longer is tried again.
 */
const LOOK_LIMIT_MS = 2_000;

/**
 * Waits until the WebView of process `pid` shows the app's page, as its
 * DevTools socket lists it. Attaching while the page is still blank, with
 * the app's worker starting, can leave Playwright waiting for the page
 * forever (seen in 4 of 30 restarts; none in 50 after waiting for this).
 * Waits up to `timeout` ms.
 */
async function appPageLoaded(pid, timeout) {
  const port = adb("forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`);
  const shown = async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
      signal: AbortSignal.timeout(LOOK_LIMIT_MS),
    })
      .then((response) => response.json())
      .catch(() => []);
    return targets.some((target) => target.type === "page" && originOf(target.url) === APP_ORIGIN);
  };
  try {
    await expect.poll(shown, { message: "the app's page to load", timeout }).toBe(true);
  } finally {
    adb("forward", "--remove", `tcp:${port}`);
  }
}

/** Starts the app on `device` and attaches to its page. */
export async function startAndAttach({ device, shell }) {
  await shell(`am start -W -n ${ACTIVITY}`);
  await appPageLoaded(await shell(`pidof ${PACKAGE}`), WAIT_LIMIT_MS);
  const webView = await device.webView({ pkg: PACKAGE });
  // Playwright sets no limit on attaching to the page, so this sets one.
  const page = await within(webView.page(), "the app's page to attach");
  return { webView, page };
}

/** The window of an "isn't responding" dialog, or nothing while there's none. */
const NOT_RESPONDING_WINDOW = "dumpsys window windows | grep -m1 'Application Not Responding' || true";
/** How long the dialog may take to go once Wait is tapped, in ms. */
const DIALOG_GONE_MS = 10_000;

/**
 * Closes the dialog a slow emulator shows when another app, often the
 * launcher, "isn't responding" (hide_error_dialogs doesn't keep it away),
 * choosing Wait. It sits over the app and takes taps and the Back key.
 * Returns whether there was one.
 */
export async function closeNotResponding(shell) {
  const dialog = await shell(NOT_RESPONDING_WINDOW);
  if (!dialog) return false;
  console.log("closing:", dialog.trim());
  const layout = "/data/local/tmp/not-responding.xml";
  const xml = await shell(`rm -f ${layout}; uiautomator dump ${layout} > /dev/null 2>&1; cat ${layout}`);
  const bounds = /text="Wait"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(xml);
  if (bounds) {
    const [x1, y1, x2, y2] = bounds.slice(1).map(Number);
    await shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
  }
  // A key or tap sent while the dialog is still going takes its place.
  await expect
    .poll(() => shell(NOT_RESPONDING_WINDOW), { message: "the dialog to go", timeout: DIALOG_GONE_MS })
    .toBe("");
  return true;
}
