#!/usr/bin/env node
// Drives the shard editor on an Android emulator the way a person would, with
// the system's own keyboard: types into a new shard, uses the bar above the
// keyboard and its style panel, the / menu, the long-press block menu and a
// link, and checks each change on disk. Works on a copy of the sample vault.
//
//   APK=app.apk [VAULT=path/to/sample-vault] node scripts/android-editor-check.mjs out
//
// Without VAULT (on CI, which has no copy of the sample vault) it writes the
// shards of it that the check opens.
// The APK must be built with ORG_GRADLE_PROJECT_netherstoneInspectable=true.
// The page is read with Playwright's Android support. Taps and long presses
// go through `adb shell input`, like a finger, so the keyboard and long-press
// behave as on a phone; where to tap is found once by tapping and reading
// back where the page saw it. Every wait has a limit. When a step fails, the
// output folder gets the page and the whole screen as pictures, the page's
// text, where focus and the caret were, and the device log. A failed step
// doesn't stop the check: the steps that don't build on it still run, so one
// run shows every failure. The check fails if any step did.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { _android as android, expect } from "@playwright/test";

const PACKAGE = "tech.blueblood.netherstone";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const OUT = process.argv[2] ?? "android-editor-check";
const APK = process.env.APK;
/** A web page a shard links to: the site, from the app's own list of links. */
const WEB_PAGE = JSON.parse(fs.readFileSync("src/data/links.json", "utf8")).site;
/** A one-pixel PNG, pasted as a picture. */
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const VAULT = process.env.VAULT ?? smallVault();
const SHARD = "touch-check";
// The buttons of Android's own permission prompt, by what they say.
const DENY = /^Don.t allow$/;
const ALLOW = /^While using the app$/;

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
    "# Start here\n\n- [Writing basics](Guide/Writing%20basics.md): headings, text styles, lists and tasks\n" +
      "- [Links](Guide/Links.md): links between shards, to the web and to headings\n",
  );
  fs.writeFileSync(
    path.join(folder, "Guide", "Writing basics.md"),
    "# Writing basics\n\nEvery heading level, the text styles and the kinds of list. #guide\n",
  );
  fs.writeFileSync(path.join(folder, "Guide", "Links.md"), `# Links\n\n- [The website](${WEB_PAGE})\n`);
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

/** The package of the app in front, or "" while none is. */
async function appInFront() {
  const line = await shell("dumpsys activity activities | grep -m1 topResumedActivity");
  return line.match(/ u0 ([\w.]+)\//)?.[1] ?? "";
}

/** Closes whatever app is in front of this one, as a person would. */
async function bringAppBack() {
  const other = await appInFront();
  if (other === PACKAGE) return;
  if (other) await shell(`am force-stop ${other}`);
  // The launcher's own way in: brings the running app back as it was.
  await shell(`am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${ACTIVITY}`);
  await poll(appInFront, "the app back in front").toBe(PACKAGE);
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

/**
 * Taps a button of a system window (not the app's page) by what it says,
 * found in the screen's layout as Android describes it. `uiautomator dump`
 * can be killed after writing its file, so only the file is read.
 */
async function tapSystemButton(label) {
  const layout = "/data/local/tmp/layout.xml";
  const boundsOf = async () => {
    const xml = await shell(`rm -f ${layout}; uiautomator dump ${layout} > /dev/null 2>&1; cat ${layout}`);
    for (const [, text, bounds] of xml.matchAll(/text="([^"]*)"[^>]*bounds="([^"]+)"/g)) {
      if (label.test(text)) return bounds;
    }
    return null;
  };
  await poll(boundsOf, `a button saying ${label}`).not.toBeNull();
  const [x1, y1, x2, y2] = (await boundsOf()).match(/\d+/g).map(Number);
  await shell(`input tap ${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`);
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
/**
 * Runs a step. Steps of the setup stop the check when they fail; any other
 * step is skipped when a step it `needs` didn't pass.
 */
async function step(name, run, { needs = [], setup = false } = {}) {
  const label = `${String(steps.length + 1).padStart(2, "0")}-${name}`;
  const missing = needs.filter((need) => !steps.some((s) => s.name === need && s.ok));
  if (missing.length) {
    log("== skip", name, "(needs", missing.join(", ") + ")");
    steps.push({ name, ok: false, skipped: true, error: `Needs ${missing.join(", ")}` });
    return;
  }
  log("==", name);
  try {
    await run();
    steps.push({ name, ok: true });
    await device.screenshot({ path: path.join(OUT, `${label}.png`) });
  } catch (error) {
    log("failed:", name, String(error?.message ?? error).split("\n")[0]);
    steps.push({ name, ok: false, error: String(error?.stack ?? error) });
    await saveFailure(`${label}-failed`);
    if (setup) throw error;
    await recover();
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
  await save("where focus and the caret were", async () =>
    fs.writeFileSync(path.join(OUT, `${label}-focus.json`), JSON.stringify(await focusState(), null, 1)),
  );
  await save("the screen picture", () => device.screenshot({ path: path.join(OUT, `${label}-screen.png`) }));
}

/** What has focus, where the page's caret is, and whether the keyboard is up. */
async function focusState() {
  const keyboardShown = /mInputShown=true/.test(await shell("dumpsys input_method"));
  const inPage = await page.evaluate(() => {
    const describe = (node) => {
      if (!node) return null;
      const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
      return {
        node: node.nodeName,
        text: node.nodeType === Node.TEXT_NODE ? node.textContent.slice(0, 80) : undefined,
        element: element?.outerHTML.slice(0, 200),
        inEditor: !!element?.closest("[data-slate-editor]"),
      };
    };
    const selection = getSelection();
    return {
      active: describe(document.activeElement),
      anchor: describe(selection.anchorNode),
      anchorOffset: selection.anchorOffset,
      ranges: selection.rangeCount,
      keyboardInset: getComputedStyle(document.documentElement).getPropertyValue("--keyboard-inset"),
    };
  });
  return { keyboardShown, ...inPage };
}

/**
 * After a failed step: closes whatever system window, menu or sheet it left
 * open.
 */
async function recover() {
  try {
    if ((await appInFront()) !== PACKAGE) await shell("input keyevent KEYCODE_BACK");
    await bringAppBack();
    for (let i = 0; i < 2; i++) await page.keyboard.press("Escape");
  } catch (error) {
    log("couldn't recover:", error.message);
  }
}

/** Waits until `read` gives what's expected, up to the wait limit. */
const poll = (read, message) => expect.poll(read, { timeout: WAIT_LIMIT_MS, message });
/** Waits for the shard's file on disk to be as expected. */
const onDisk = () => poll(() => readAppFile(shardFile));

/** Puts the caret at the end of the shard's title, with the keyboard up. */
async function typeAfterTitle() {
  await tap(block(SHARD), 0.98);
  await expect(editor()).toBeFocused();
  await poll(keyboardInset, "--keyboard-inset").toBeGreaterThan(0);
  await shell("input keyevent KEYCODE_MOVE_END");
}

/** Starts a new line after the shard's title, ready to type on. */
async function newLine() {
  await typeAfterTitle();
  await shell("input keyevent KEYCODE_ENTER");
}

/** Asks for a voice note from the / menu, on a new line. */
async function startVoiceNote() {
  await newLine();
  await typeKeys("/voice");
  await tap(page.getByRole("option", { name: "Voice note" }));
}

/** Drops a voice note a failed step left in the shard, so later steps see the shard as it was. */
async function discardVoiceNote() {
  const discard = page.getByRole("group", { name: "Voice note recording" }).getByRole("button", { name: "Discard" });
  if (await discard.isVisible()) await tap(discard);
}

const editor = () => page.locator("[data-slate-editor]").first();
const block = (text) => editor().locator("[data-slate-node=element]").filter({ hasText: text }).last();
const bar = () => page.getByRole("toolbar", { name: "Formatting" });
const home = () => page.getByRole("button", { name: "Search this vault" });

/** Goes back to the vault's home with the app's own Back, then opens a shard listed there. */
async function openFromHome(name) {
  const back = page.getByRole("button", { name: "Back", exact: true });
  await expect(home().or(back).first()).toBeVisible();
  while (await back.isVisible()) await back.click();
  await expect(home()).toBeVisible();
  const named = new RegExp(`^${name}`);
  await page.getByRole("region", { name: "Files" }).getByRole("button", { name: named }).first().click();
  await expect(editor()).toBeVisible();
}

let vault;
let shardFile;
try {
  if (await shell(`pm list packages ${PACKAGE}`)) await shell(`pm uninstall ${PACKAGE}`);
  log("install", APK);
  // No permissions given up front: the microphone is asked for as on a phone.
  adb("install", APK);
  await shell("wm dismiss-keyguard");
  // A slow emulator can say another app "isn't responding" in a dialog over
  // this one, which would take the check's taps.
  await shell("settings put global hide_error_dialogs 1");
  adb("logcat", "-c");

  const setup = { setup: true };
  await step(
    "welcome-tour",
    async () => {
      await launch();
      await page.getByRole("button", { name: "Get started" }).click();
      await page.getByRole("button", { name: /^Create a new vault/ }).click();
      await page.getByRole("button", { name: "Create vault", exact: true }).click();
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Take your vault everywhere" })).toBeVisible();
    },
    setup,
  );

  await step("github-sign-in", async () => {
    // GitHub gives a code (so the app reached it), and the phone's browser
    // opens on GitHub's page for it. The sign-in itself needs an account.
    await page.getByRole("button", { name: "Connect GitHub" }).click();
    try {
      await expect(page.getByText("Waiting for you to approve on GitHub")).toBeVisible();
      await page.getByRole("button", { name: "Copy code and open GitHub" }).click();
      const other = async () => ![PACKAGE, ""].includes(await appInFront());
      await poll(other, "another app in front").toBe(true);
      // Closing the browser brings the app back: starting the app again can
      // leave the browser's first-run screen in front.
      await shell(`am force-stop ${await appInFront()}`);
      await poll(appInFront, "the app back in front").toBe(PACKAGE);
      // Still waiting: a poll that failed while the app was in the background
      // doesn't end the sign-in.
      await expect(page.getByText("Waiting for you to approve on GitHub")).toBeVisible();
    } finally {
      // Back to where the tour goes on, whatever happened.
      await bringAppBack();
      const cancel = page.getByRole("button", { name: "Cancel" });
      if (await cancel.isVisible()) await cancel.click();
    }
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
  });

  await step(
    "welcome-tour-end",
    async () => {
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Skip for now" }).click();
      await page.getByRole("button", { name: "Open Netherstone" }).click();
      await expect(home()).toBeVisible();
      vault = await page.evaluate(
        () => JSON.parse(localStorage.getItem("netherstone-vault")).state.currentVaultPath,
      );
      log("vault", vault);
    },
    setup,
  );

  await step(
    "sample-vault",
    async () => {
      // A copy, owned by the app as if it had written it.
      adb("push", VAULT, "/data/local/tmp/sample-vault");
      const owner = await su(`stat -c %u:%g '${vault}'`);
      await su(`cp -r /data/local/tmp/sample-vault/. '${vault}/' && chown -R ${owner} '${vault}'`);
      // The shard the check types in.
      shardFile = `${vault}/${SHARD}.md`;
      await su(`printf '# ${SHARD}\\n' > '${shardFile}' && chown ${owner} '${shardFile}'`);
      await launch();
      await calibrate(page.getByRole("heading", { name: "Files", exact: true }));
    },
    setup,
  );

  await step(
    "open-shard",
    async () => {
      await openFromHome(SHARD);
      await expect(block(SHARD)).toBeVisible();
    },
    setup,
  );

  await step(
    "keyboard-up",
    async () => {
      // A tap at the end of the title puts the caret there and brings up the
      // system keyboard, with the bar above it.
      await tap(block(SHARD), 0.98);
      await poll(keyboardInset, "--keyboard-inset").toBeGreaterThan(0);
      await expect(bar()).toBeVisible();
      // The page ends above the keyboard, so the bar sits on it.
      const barBox = await bar().boundingBox();
      const height = await page.evaluate(() => window.innerHeight);
      expect(Math.abs(barBox.y + barBox.height - height)).toBeLessThan(2);
    },
    setup,
  );

  // Each step that types starts its own line under the shard's title.
  await step("type-and-save", async () => {
    await newLine();
    await typeKeys("typed with the keyboard");
    await expect(editor()).toContainText("typed with the keyboard");
    await onDisk().toContain("typed with the keyboard");
    // The caret stays above the bar.
    const caretBottom = await page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().bottom);
    expect(caretBottom).toBeLessThanOrEqual((await bar().boundingBox()).y);
  });

  const typed = { needs: ["type-and-save"] };
  await step(
    "bar-list",
    async () => {
      await tap(block("typed with the keyboard"), 0.98);
      await tap(bar().getByRole("button", { name: "Bulleted list" }));
      await onDisk().toContain("- typed with the keyboard");
      await expect(editor()).toBeFocused();
      await poll(keyboardInset).toBeGreaterThan(0);
      await tap(bar().getByRole("button", { name: "Undo" }));
      await onDisk().not.toContain("- typed");
    },
    typed,
  );

  await step(
    "style-panel",
    async () => {
      await tap(block("typed with the keyboard"), 0.98);
      await tap(bar().getByRole("button", { name: "Text style" }));
      const panel = page.getByRole("group", { name: "Text style" });
      await expect(panel).toBeVisible();
      // The keyboard makes way for the panel, and the caret stays.
      await poll(keyboardInset).toBe(0);
      await expect(editor()).toBeFocused();
      await tap(panel.getByRole("button", { name: "H2" }));
      await onDisk().toContain("## typed with the keyboard");
      // Back to the keyboard.
      await tap(bar().getByRole("button", { name: "Text style" }));
      await expect(panel).toBeHidden();
      await poll(keyboardInset).toBeGreaterThan(0);
    },
    typed,
  );

  await step("slash-menu", async () => {
    await newLine();
    await typeKeys("/quote");
    const option = page.getByRole("option", { name: "Blockquote" });
    await expect(option).toBeVisible();
    await tap(option);
    // The menu gives focus back to the shard; then the keyboard types there.
    await expect(editor()).toBeFocused();
    await typeKeys("quoted line");
    await expect(editor()).toContainText("quoted line");
    await onDisk().toContain("> quoted line");
  });

  await step("voice-note-refused", async () => {
    try {
      await startVoiceNote();
      await tapSystemButton(DENY);
      await expect(page.getByText("Microphone access is off for Netherstone")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open system settings" })).toBeVisible();
    } finally {
      await discardVoiceNote();
    }
  });

  await step(
    "voice-note-allowed",
    async () => {
      try {
        // Refused once, Android asks again the next time.
        await startVoiceNote();
        await tapSystemButton(ALLOW);
        await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeAttached();
        await tap(page.getByRole("button", { name: "Save" }));
        await expect(page.getByRole("group", { name: "Audio" })).toBeVisible();
        await onDisk().toMatch(/_attachments\/[^)"]+\.webm/);
      } finally {
        await discardVoiceNote();
      }
    },
    { needs: ["voice-note-refused"] },
  );

  await step("paste-picture", async () => {
    await newLine();
    // As a keyboard's clipboard pastes it: a file in the paste's data.
    await editor().evaluate((element, base64) => {
      const transfer = new DataTransfer();
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      transfer.items.add(new File([bytes], "pasted.png", { type: "image/png" }));
      element.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
    }, PNG);
    await onDisk().toContain("_attachments/pasted.png");
    await poll(() => su(`base64 '${vault}/_attachments/pasted.png' | tr -d '\\n'`)).toBe(PNG);
  });

  await step("hide-keyboard", async () => {
    await tap(block(SHARD), 0.98);
    await expect(bar()).toBeVisible();
    await tap(bar().getByRole("button", { name: "Hide keyboard" }));
    await poll(keyboardInset).toBe(0);
    await expect(bar()).toBeHidden();
  });

  await step(
    "block-menu",
    async () => {
      // The title moves down below the line that follows it.
      await longPress(block(SHARD));
      const sheet = page.getByRole("dialog", { name: "Heading 1" });
      await expect(sheet).toBeVisible();
      await tap(sheet.getByRole("button", { name: "Move down" }));
      await expect(sheet).toBeHidden();
      await onDisk().toMatch(/^.+\s+# touch-check/);
    },
    { needs: ["hide-keyboard"] },
  );

  await step("link-tap", async () => {
    await openFromHome("Start here");
    await tap(editor().getByText("Writing basics", { exact: true }).first());
    await expect(editor()).toContainText("Every heading level");
  });

  await step("web-link-tap", async () => {
    // Phones have no browser panel yet: the page opens in the system's browser.
    try {
      await openFromHome("Start here");
      await tap(editor().getByText("Links", { exact: true }).first());
      await tap(editor().getByText("The website", { exact: true }).first());
      await poll(appInFront, "the system's browser in front").not.toMatch(new RegExp(`^(${PACKAGE})?$`));
    } finally {
      await bringAppBack();
    }
  });

  await step(
    "reopen",
    async () => {
      await launch();
      await openFromHome(SHARD);
      await expect(editor()).toContainText("typed with the keyboard");
    },
    typed,
  );
} finally {
  fs.writeFileSync(path.join(OUT, "steps.json"), JSON.stringify(steps, null, 1));
  const summary = steps.map((s) => `${s.ok ? "pass" : s.skipped ? "skip" : "FAIL"} ${s.name}`).join("\n");
  log("steps:\n" + summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Android editor\n\n\`\`\`\n${summary}\n\`\`\`\n`);
  }
  try {
    fs.writeFileSync(path.join(OUT, "logcat.txt"), adb("logcat", "-d", "-v", "time"));
  } catch (error) {
    log("couldn't save the device log:", error.message);
  }
  await device.close();
}
if (steps.some((s) => !s.ok)) {
  log("some steps failed");
  process.exit(1);
}
log("all steps passed");
