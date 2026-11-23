#!/usr/bin/env node
// Drives the shard editor on an Android emulator the way a person would, with
// the system's own keyboard: types into a new shard, uses the bar above the
// keyboard and its style panel, the / menu, the long-press block menu and a
// link, and checks each change on disk. Works on a copy of the sample vault.
//
//   APK=app.apk [VAULT=path/to/sample-vault] node scripts/android-editor-check.mjs out
//
// Without VAULT (on CI, which has no copy of the sample vault) it writes the
// two shards of it that the check opens.
// The APK must be built with ORG_GRADLE_PROJECT_netherstoneInspectable=true.
// The page is read with Playwright's Android support. Taps and long presses
// go through `adb shell input`, like a finger, so the keyboard and long-press
// behave as on a phone; where to tap is found once by tapping and reading
// back where the page saw it. Every wait has a limit. When a step fails, the
// output folder gets the page and the whole screen as pictures, the page's
// text, and the device log.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { _android as android, expect } from "@playwright/test";

const PACKAGE = "tech.blueblood.netherstone";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const OUT = process.argv[2] ?? "android-editor-check";
const APK = process.env.APK;
const VAULT = process.env.VAULT ?? smallVault();
const SHARD = "touch-check";

// How long one wait may take. Far above any step on a CI emulator, so only a
// stuck step reaches it.
const WAIT_LIMIT_MS = Number(process.env.WAIT_LIMIT_MS ?? 60_000);
// A press this long is a long press on any Android version (the system's
// own threshold is 400-500 ms).
const LONG_PRESS_MS = 1000;

if (!APK) throw new Error("Set APK to the APK to install");
fs.mkdirSync(OUT, { recursive: true });
expect.configure({ timeout: WAIT_LIMIT_MS });

const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);
function adb(...args) {
  try {
    return execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 << 20, timeout: WAIT_LIMIT_MS }).trim();
  } catch (error) {
    throw new Error(`adb ${args.join(" ")} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

/** Waits for `promise`, failing once the wait limit has passed. */
async function within(promise, what) {
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

/** The sample vault's shards that this check opens, in a new folder. */
function smallVault() {
  const folder = fs.mkdtempSync(path.join(fs.realpathSync(process.env.RUNNER_TEMP ?? "/tmp"), "vault-"));
  fs.mkdirSync(path.join(folder, "Guide"));
  fs.writeFileSync(
    path.join(folder, "Start here.md"),
    "# Start here\n\n- [Writing basics](Guide/Writing%20basics.md): headings, text styles, lists and tasks\n",
  );
  fs.writeFileSync(
    path.join(folder, "Guide", "Writing basics.md"),
    "# Writing basics\n\nEvery heading level, the text styles and the kinds of list. #guide\n",
  );
  return folder;
}

// ---- The app ----

const [device] = await android.devices({ omitDriverInstall: true });
if (!device) throw new Error("No Android device or emulator is connected");
device.setDefaultTimeout(WAIT_LIMIT_MS);

const shell = async (command) =>
  (await within(device.shell(command), `adb shell ${command}`)).toString().trim();
/** Runs a command as root (the emulator image allows it). */
const su = (command) => shell(`su 0 sh -c "${command.replaceAll('"', '\\"')}"`);
const readAppFile = (file) => su(`cat '${file}'`);

let webView;
let page;
/** Screen px per CSS px, and where the page's top left is on screen. */
let screen = { scale: 1, x: 0, y: 0 };

async function launch() {
  if (webView) {
    const closed = new Promise((resolve) => webView.once("close", resolve));
    await shell(`am force-stop ${PACKAGE}`);
    await within(closed, "the old WebView to close");
  }
  await shell(`am start -W -n ${ACTIVITY}`);
  webView = await device.webView({ pkg: PACKAGE });
  page = await within(webView.page(), "the app's page to attach");
  page.setDefaultTimeout(WAIT_LIMIT_MS);
  page.on("pageerror", (error) => log("page error:", error.message));
}

/**
 * Finds where the page sits on screen: taps `target` where it would be if
 * the page filled the screen, reads where the page saw the touch, and works
 * out the offset from that. `target` is plain text, so the tap does nothing.
 */
async function calibrate(target) {
  const scale = await page.evaluate(() => window.devicePixelRatio);
  const seen = page.evaluate(
    () =>
      new Promise((resolve) =>
        window.addEventListener("pointerdown", (e) => resolve({ x: e.clientX, y: e.clientY }), {
          once: true,
          capture: true,
        }),
      ),
  );
  screen = { scale, x: 0, y: 0 };
  const at = await pointOn(target);
  await shell(`input tap ${at.x} ${at.y}`);
  const client = await within(seen, "the calibration tap");
  screen = { scale, x: at.x - client.x * scale, y: at.y - client.y * scale };
  log("screen", screen);
}

/** The screen point at `fx`, `fy` (0 to 1) across an element. */
async function pointOn(locator, fx = 0.5, fy = 0.5) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} has no box`);
  return {
    x: Math.round(screen.x + (box.x + box.width * fx) * screen.scale),
    y: Math.round(screen.y + (box.y + box.height * fy) * screen.scale),
  };
}

/** A finger tap. */
async function tap(locator, fx, fy) {
  const { x, y } = await pointOn(locator, fx, fy);
  await shell(`input tap ${x} ${y}`);
}

/** A finger held still on an element. */
async function longPress(locator) {
  const { x, y } = await pointOn(locator, 0.3);
  await shell(`input swipe ${x} ${y} ${x} ${y} ${LONG_PRESS_MS}`);
}

/** Text typed on the keyboard, one key at a time. */
async function typeKeys(text) {
  await shell(`input text '${text.replaceAll(" ", "%s")}'`);
}

const keyboardInset = () =>
  page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset") || "0"),
  );

// ---- Steps ----

const steps = [];
async function step(name, run) {
  const label = `${String(steps.length + 1).padStart(2, "0")}-${name}`;
  log("==", name);
  try {
    await run();
    steps.push({ name, ok: true });
    await device.screenshot({ path: path.join(OUT, `${label}.png`) });
  } catch (error) {
    steps.push({ name, ok: false, error: String(error?.stack ?? error) });
    await saveFailure(`${label}-failed`);
    throw error;
  }
}

async function saveFailure(label) {
  const save = async (what, write) => {
    try {
      await write();
    } catch (error) {
      log(`couldn't save ${what}:`, error.message);
    }
  };
  await save("the page picture", () => page.screenshot({ path: path.join(OUT, `${label}.png`) }));
  await save("the page text", async () =>
    fs.writeFileSync(path.join(OUT, `${label}.txt`), await page.locator("body").innerText()),
  );
  await save("the screen picture", () => device.screenshot({ path: path.join(OUT, `${label}-screen.png`) }));
}

const editor = () => page.locator("[data-slate-editor]").first();
const block = (text) => editor().locator("[data-slate-node=element]").filter({ hasText: text }).last();
const bar = () => page.getByRole("toolbar", { name: "Formatting" });
const sidebar = () => page.locator('[data-sidebar="sidebar"]');

/**
 * Until the app has a phone layout, the desktop sidebars leave a shard no
 * room on a phone screen: close them as a person would, when they're there.
 */
async function roomForTheShard() {
  for (const name of ["Hide left sidebar", "Hide right sidebar"]) {
    const button = page.getByRole("button", { name });
    if (await button.isVisible()) await button.click();
  }
}

/** Opens a shard from the left sidebar by its name. */
async function openFromSidebar(name) {
  const show = page.getByRole("button", { name: "Show left sidebar" });
  if (await show.isVisible()) await show.click();
  await sidebar().getByText(name, { exact: true }).first().click();
  await expect(editor()).toBeVisible();
  await roomForTheShard();
}

let vault;
let shardFile;
try {
  if (await shell(`pm list packages ${PACKAGE}`)) await shell(`pm uninstall ${PACKAGE}`);
  log("install", APK);
  adb("install", "-g", APK);
  await shell("wm dismiss-keyguard");
  adb("logcat", "-c");

  await step("welcome-tour", async () => {
    await launch();
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByRole("button", { name: /^Create a new vault/ }).click();
    await page.getByRole("button", { name: "Create vault", exact: true }).click();
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await page.getByRole("button", { name: "Open Netherstone" }).click();
    await expect(sidebar()).toBeVisible();
    vault = await page.evaluate(
      () => JSON.parse(localStorage.getItem("netherstone-vault")).state.currentVaultPath,
    );
    log("vault", vault);
  });

  await step("sample-vault", async () => {
    // A copy, owned by the app as if it had written it.
    adb("push", VAULT, "/data/local/tmp/sample-vault");
    const owner = await su(`stat -c %u:%g '${vault}'`);
    await su(`cp -r /data/local/tmp/sample-vault/. '${vault}/' && chown -R ${owner} '${vault}'`);
    await launch();
    await calibrate(sidebar().getByText("Files", { exact: true }).first());
    await expect(sidebar().getByText("Start here", { exact: true }).first()).toBeVisible();
  });

  await step("create-shard", async () => {
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "New shard" }).click();
    const name = page.locator("#shard-name");
    await expect(name).toBeFocused();
    await page.keyboard.type(SHARD);
    await page.getByRole("button", { name: "Create shard" }).click();
    await expect(name).toBeHidden();
    shardFile = `${vault}/${SHARD}.md`;
    await expect.poll(() => readAppFile(shardFile)).toContain(`# ${SHARD}`);
    await roomForTheShard();
  });

  await step("keyboard-up", async () => {
    // A tap at the end of the title puts the caret there and brings up the
    // system keyboard, with the bar above it.
    await tap(block(SHARD), 0.98);
    await expect.poll(keyboardInset, { message: "--keyboard-inset" }).toBeGreaterThan(0);
    await expect(bar()).toBeVisible();
    // The page ends above the keyboard, so the bar sits on it.
    const barBox = await bar().boundingBox();
    const height = await page.evaluate(() => window.innerHeight);
    expect(Math.abs(barBox.y + barBox.height - height)).toBeLessThan(2);
  });

  await step("type-and-save", async () => {
    await shell("input keyevent KEYCODE_MOVE_END");
    await shell("input keyevent KEYCODE_ENTER");
    await typeKeys("typed with the keyboard");
    await expect(editor()).toContainText("typed with the keyboard");
    await expect.poll(() => readAppFile(shardFile)).toContain("typed with the keyboard");
    // The caret stays above the bar.
    const caretBottom = await page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().bottom);
    expect(caretBottom).toBeLessThanOrEqual((await bar().boundingBox()).y);
  });

  await step("bar-list", async () => {
    await tap(bar().getByRole("button", { name: "Bulleted list" }));
    await expect.poll(() => readAppFile(shardFile)).toContain("- typed with the keyboard");
    await expect(editor()).toBeFocused();
    await expect.poll(keyboardInset).toBeGreaterThan(0);
    await tap(bar().getByRole("button", { name: "Undo" }));
    await expect.poll(() => readAppFile(shardFile)).not.toContain("- typed");
  });

  await step("style-panel", async () => {
    await tap(bar().getByRole("button", { name: "Text style" }));
    const panel = page.getByRole("group", { name: "Text style" });
    await expect(panel).toBeVisible();
    // The keyboard makes way for the panel, and the caret stays.
    await expect.poll(keyboardInset).toBe(0);
    await expect(editor()).toBeFocused();
    await tap(panel.getByRole("button", { name: "H2" }));
    await expect.poll(() => readAppFile(shardFile)).toContain("## typed with the keyboard");
    // Back to the keyboard.
    await tap(bar().getByRole("button", { name: "Text style" }));
    await expect(panel).toBeHidden();
    await expect.poll(keyboardInset).toBeGreaterThan(0);
  });

  await step("slash-menu", async () => {
    await shell("input keyevent KEYCODE_MOVE_END");
    await shell("input keyevent KEYCODE_ENTER");
    await typeKeys("/quote");
    const option = page.getByRole("option", { name: "Blockquote" });
    await expect(option).toBeVisible();
    await tap(option);
    await typeKeys("quoted line");
    await expect.poll(() => readAppFile(shardFile)).toContain("> quoted line");
  });

  await step("hide-keyboard", async () => {
    await tap(bar().getByRole("button", { name: "Hide keyboard" }));
    await expect.poll(keyboardInset).toBe(0);
    await expect(bar()).toBeHidden();
  });

  await step("block-menu", async () => {
    await longPress(block("quoted line"));
    const sheet = page.getByRole("dialog", { name: "Quote" });
    await expect(sheet).toBeVisible();
    await tap(sheet.getByRole("button", { name: "Move up" }));
    await expect(sheet).toBeHidden();
    await expect
      .poll(() => readAppFile(shardFile))
      .toMatch(/> quoted line\s+## typed with the keyboard/);
  });

  await step("link-tap", async () => {
    await openFromSidebar("Start here");
    await tap(editor().getByText("Writing basics", { exact: true }).first());
    await expect(editor()).toContainText("Every heading level");
  });

  await step("reopen", async () => {
    await launch();
    await openFromSidebar(SHARD);
    await expect(editor()).toContainText("quoted line");
  });
} finally {
  fs.writeFileSync(path.join(OUT, "steps.json"), JSON.stringify(steps, null, 1));
  try {
    fs.writeFileSync(path.join(OUT, "logcat.txt"), adb("logcat", "-d", "-v", "time"));
  } catch (error) {
    log("couldn't save the device log:", error.message);
  }
  await device.close();
}
log("all steps passed");
