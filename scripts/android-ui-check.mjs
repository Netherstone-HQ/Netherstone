#!/usr/bin/env node
// Drives the Android app on an emulator the way a person would: goes through
// the welcome tour, creates a shard from home, types into it, checks the
// file on disk, goes back home with the system Back key, then restarts the
// app, opens the shard from Recent and checks the text is back. Then it
// exports, uses the trash, saves a link and a picture another app shares,
// and imports a document another app opens with Netherstone.
//
//   APK=app.apk node scripts/android-ui-check.mjs out
//
// The APK must be built with ORG_GRADLE_PROJECT_netherstoneInspectable=true.
// Playwright's Android support attaches to the app's WebView over DevTools:
// elements are found by role and name, and clicks and keys are sent as input
// events at the element, so nothing depends on screen coordinates. Every
// wait is on a condition and has a limit. When a step fails, the output
// folder gets the page and the whole screen as pictures, the page's text,
// and the device log.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { _android as android, expect as baseExpect } from "@playwright/test";
import { startAndAttach } from "./android-webview.mjs";

const PACKAGE = "tech.blueblood.netherstone";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const OUT = process.argv[2] ?? "android-ui-check";
const APK = process.env.APK;
// What + calls a new shard in a vault that has none by that name.
const SHARD = "Untitled";
const TYPED = "typed on the emulator";
// What another app shares and opens with Netherstone.
const SHARED_LINK = "https://example.com/shared-page";
const SHARED_TITLE = "Shared page";
const SHARED_PICTURE = "shared-picture.png";
const PICTURE_FILE = "src-tauri/icons/32x32.png";
const OPENED_NOTE = "opened-note.md";
const OPENED_TEXT = "opened from another app";

// How long one wait may take. Far above any step on a CI emulator, so only a
// stuck step reaches it.
const WAIT_LIMIT_MS = Number(process.env.WAIT_LIMIT_MS ?? 60_000);

if (!APK) throw new Error("Set APK to the APK to install");
fs.mkdirSync(OUT, { recursive: true });
// configure returns a new expect; the imported one keeps its 5 s limit.
const expect = baseExpect.configure({ timeout: WAIT_LIMIT_MS });

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

// ---- The app ----

const [device] = await android.devices({ omitDriverInstall: true });
if (!device) throw new Error("No Android device or emulator is connected");
device.setDefaultTimeout(WAIT_LIMIT_MS);

const shell = async (command) =>
  (await within(device.shell(command), `adb shell ${command}`)).toString().trim();

/** Reads a file in the app's private storage (the emulator image allows root). */
const readAppFile = (file) => shell(`su 0 cat '${file}'`);

let webView;
let page;

/** Starts the app fresh and attaches to its page once it's there. */
async function launch() {
  if (webView) {
    const closed = new Promise((resolve) => webView.once("close", resolve));
    await shell(`am force-stop ${PACKAGE}`);
    await within(closed, "the old WebView to close");
  }
  ({ webView, page } = await startAndAttach({ device, pkg: PACKAGE, activity: ACTIVITY, shell, within, timeout: WAIT_LIMIT_MS }));
  page.setDefaultTimeout(WAIT_LIMIT_MS);
  page.on("pageerror", (error) => log("page error:", error.message));
}

/** The text on screen, as Android describes it, whichever app shows it. */
async function screenText() {
  const layout = "/data/local/tmp/layout.xml";
  const xml = await shell(`rm -f ${layout}; uiautomator dump ${layout} > /dev/null 2>&1; cat ${layout}`);
  return [...xml.matchAll(/text="([^"]+)"/g)].map(([, text]) => text).join("\n");
}

/** Whether the app is the one in front. */
const appInFront = async () =>
  (await shell("dumpsys activity activities | grep -m1 topResumedActivity")).includes(PACKAGE);

/** Whether `file` is in the app's private storage. */
const appFileExists = async (file) =>
  (await shell(`su 0 test -e '${file}' && echo yes || echo no`)) === "yes";

const keyboardUp = async () => /mInputShown=true/.test(await shell("dumpsys input_method"));

/**
 * Android's own Back key, as a thumb would press it, from a shard to home.
 * While the keyboard is up, the first press only puts it away.
 */
async function backToHome() {
  if (await keyboardUp()) {
    await shell("input keyevent KEYCODE_BACK");
    await expect.poll(keyboardUp, { message: "the keyboard to go away" }).toBe(false);
  }
  await shell("input keyevent KEYCODE_BACK");
  await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
}

/** The shard's row in the Files list on home. */
const shardRow = (section = "Files") =>
  page.getByRole("region", { name: section }).getByRole("button", { name: new RegExp(`^${SHARD}`) });

/** Moves the shard to the trash from its row's menu on home. */
async function trashFromHome() {
  // A press and hold opens the row's menu, as a right click does.
  await shardRow().click({ button: "right" });
  await page.getByRole("button", { name: "Move to trash" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Move to trash" }).click();
  // The newest one: the toast of a delete just before may still show.
  await expect(page.getByText("Moved to Trash").last()).toBeVisible();
  await expect.poll(() => appFileExists(shardFile), { message: `${shardFile} gone` }).toBe(false);
}

/**
 * Puts `file` in the app's cache for sharing and returns the content link
 * its file provider gives it, as another app would hand over its own files.
 */
async function providedFile(name, file) {
  const folder = `/data/data/${PACKAGE}/cache/shared`;
  const owner = await shell(`su 0 stat -c %u:%g /data/data/${PACKAGE}`);
  adb("push", file, `/data/local/tmp/${name}`);
  await shell(`su 0 sh -c "mkdir -p ${folder} && cp /data/local/tmp/${name} ${folder}/${name} && chown -R ${owner} ${folder}"`);
  return `content://${PACKAGE}.fileprovider/my_cache_images/shared/${name}`;
}

/** The sheet a share from another app opens in. */
const shareSheet = () => page.getByRole("dialog", { name: "Save to Netherstone" });

/** Opens the Trash from the vault menu. */
async function openTrash() {
  await page.getByRole("button", { name: /^My Vault/ }).click();
  await page.getByRole("button", { name: /^Trash/ }).click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
}
// ---- Steps ----

const steps = [];
async function step(name, run) {
  const label = `${String(steps.length + 1).padStart(2, "0")}-${name}`;
  log("==", name);
  try {
    await run();
    steps.push({ name, ok: true });
    await page?.screenshot({ path: path.join(OUT, `${label}.png`) });
  } catch (error) {
    steps.push({ name, ok: false, error: String(error?.stack ?? error) });
    await saveFailure(`${label}-failed`);
    throw error;
  }
}

/** Keeps what was on screen when a step failed. Each part is kept on its own. */
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
  // The whole screen as Android drew it, in case something covers the app.
  await save("the screen picture", () => device.screenshot({ path: path.join(OUT, `${label}-screen.png`) }));
}

let vault;
let shardFile;
try {
  if (await shell(`pm list packages ${PACKAGE}`)) await shell(`pm uninstall ${PACKAGE}`);
  log("install", APK);
  adb("install", "-g", APK);
  await shell("wm dismiss-keyguard");
  // A slow emulator can say another app "isn't responding" in a dialog over
  // this one, which would take the check's taps and Back presses.
  await shell("settings put global hide_error_dialogs 1");
  adb("logcat", "-c");

  await step("app-loads", async () => {
    await launch();
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  });

  await step("welcome-tour", async () => {
    await page.getByRole("button", { name: "Get started" }).click();

    // A new vault in the default place, the app's own storage.
    await page.getByRole("button", { name: /^Create a new vault/ }).click();
    await page.getByRole("button", { name: "Create vault", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Choose how it looks" })).toBeVisible();
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Take your vault everywhere" })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByRole("heading", { name: "Set up the AI assistant?" })).toBeVisible();
    await page.getByRole("button", { name: "Skip for now" }).click();

    await expect(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
    await page.getByRole("button", { name: "Open Netherstone" }).click();

    // The phone layout opens on the vault's home.
    await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
    vault = await page.evaluate(
      () => JSON.parse(localStorage.getItem("netherstone-vault")).state.currentVaultPath,
    );
    log("vault", vault);
  });

  await step("create-shard", async () => {
    // + makes an empty "Untitled" shard and opens it to type in.
    await page.getByRole("button", { name: "New shard", exact: true }).click();
    await expect(page.locator("[data-slate-editor]")).toBeVisible();
    shardFile = `${vault}/${SHARD}.md`;
  });

  await step("type-and-save", async () => {
    const editor = page.locator("[data-slate-editor]");
    await editor.locator("[data-slate-node=element]").last().click();
    await page.keyboard.type(TYPED);
    await expect(editor).toContainText(TYPED);
    await expect.poll(() => readAppFile(shardFile), { message: `${shardFile} on disk` }).toContain(TYPED);
  });

  await step("system-back", backToHome);

  await step("reopen", async () => {
    await launch();
    const recent = page.getByRole("region", { name: "Recent" });
    await recent.getByRole("button", { name: new RegExp(`^${SHARD}`) }).click();
    await expect(page.locator("[data-slate-editor]")).toContainText(TYPED);
  });

  // Export from the shard's menu: the file goes to Android's share sheet.
  for (const [label, extension, starts] of [
    ["Word document", "docx", "PK"],
    ["Web page", "html", "<!doctype html>"],
  ]) {
    await step(`share-${extension}`, async () => {
      await page.getByRole("button", { name: "More", exact: true }).click();
      await page.getByRole("button", { name: "Export", exact: true }).click();
      await page.getByRole("button", { name: label, exact: true }).click();
      const file = `${SHARD}.${extension}`;
      await expect.poll(screenText, { message: "the share sheet with the file" }).toContain(file);
      const shared = await readAppFile(`/data/data/${PACKAGE}/cache/shared/${file}`);
      expect(shared.startsWith(starts)).toBe(true);
      if (extension === "html") expect(shared).toContain(TYPED);
      // Back closes the share sheet, back to the shard.
      await shell("input keyevent KEYCODE_BACK");
      await expect(page.locator("[data-slate-editor]")).toContainText(TYPED);
      await expect.poll(appInFront, { message: "the app back in front" }).toBe(true);
    });
  }

  await step("print-pdf", async () => {
    // A PDF goes through Android's print screen, which saves it as a PDF.
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page.getByRole("button", { name: "PDF", exact: true }).click();
    await expect.poll(screenText, { message: "the print screen with a page" }).toMatch(/Paper size:[\s\S]*1\/1/);
    await shell("input keyevent KEYCODE_BACK");
    await expect.poll(appInFront, { message: "the app back in front" }).toBe(true);
    await expect(page.locator("[data-slate-editor]")).toContainText(TYPED);
  });

  await step("trash-then-undo", async () => {
    await backToHome();
    await trashFromHome();
    await page.getByRole("button", { name: "Undo" }).last().click();
    await expect.poll(() => appFileExists(shardFile), { message: `${shardFile} back` }).toBe(true);
    expect(await readAppFile(shardFile)).toContain(TYPED);
    // Home remembers it as before.
    await expect(shardRow("Recent")).toBeVisible();
  });

  await step("restore-from-trash", async () => {
    await trashFromHome();
    await openTrash();
    await page.getByRole("region", { name: "Deleted items" }).getByRole("button", { name: new RegExp(`^${SHARD}`) }).click();
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Trash is empty")).toBeVisible();
    await expect.poll(() => appFileExists(shardFile), { message: `${shardFile} restored` }).toBe(true);
    expect(await readAppFile(shardFile)).toContain(TYPED);
  });

  await step("select-and-restore", async () => {
    await shell("input keyevent KEYCODE_BACK");
    await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
    await trashFromHome();
    await openTrash();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("checkbox", { name: new RegExp(`^${SHARD}`) }).click();
    await expect(page.getByRole("heading", { name: "1 selected" })).toBeVisible();
    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByText("Trash is empty")).toBeVisible();
    await expect.poll(() => appFileExists(shardFile), { message: `${shardFile} restored` }).toBe(true);
  });
  await step("empty-trash", async () => {
    await shell("input keyevent KEYCODE_BACK");
    await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
    await trashFromHome();
    await openTrash();
    await page.getByRole("button", { name: "Empty Trash" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Empty Trash" }).click();
    await expect(page.getByText("Trash is empty")).toBeVisible();
    // Nothing of it is left in the app's data either.
    expect(await shell(`su 0 find /data/data/${PACKAGE} -path '*/trash/*'`)).toBe("");
  });

  // Another app shares a page: it's saved as a new shard, named for it.
  await step("share-in-link", async () => {
    await shell("input keyevent KEYCODE_BACK");
    await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
    await shell(
      `am start -a android.intent.action.SEND -t text/plain --es android.intent.extra.TEXT '${SHARED_LINK}' --es android.intent.extra.SUBJECT '${SHARED_TITLE}' -n ${ACTIVITY}`,
    );
    await expect(shareSheet()).toContainText(SHARED_TITLE);
    await expect(shareSheet()).toContainText(new URL(SHARED_LINK).hostname);
    await shareSheet().getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("[data-slate-editor]")).toContainText(SHARED_TITLE);
    await expect
      .poll(() => readAppFile(`${vault}/${SHARED_TITLE}.md`), { message: "the shared page's shard" })
      .toContain(`[${SHARED_TITLE}](${SHARED_LINK})`);
  });

  // Another app shares a picture: it's added to the end of the shard on screen.
  await step("share-in-picture", async () => {
    const link = await providedFile(SHARED_PICTURE, PICTURE_FILE);
    await shell(`am start -a android.intent.action.SEND -t image/png --eu android.intent.extra.STREAM ${link} -n ${ACTIVITY}`);
    await expect(shareSheet()).toContainText(SHARED_PICTURE);
    await shareSheet().getByRole("radio", { name: "Add to a shard" }).click();
    await expect(shareSheet()).toContainText(SHARED_TITLE);
    await shareSheet().getByRole("button", { name: "Save", exact: true }).click();
    await expect(shareSheet()).toBeHidden();
    const shard = `${vault}/${SHARED_TITLE}.md`;
    await expect.poll(() => readAppFile(shard), { message: "the picture in the shard" }).toContain(
      `_attachments/${SHARED_PICTURE}`,
    );
    expect(await readAppFile(shard)).toContain(SHARED_LINK);
    await expect(page.locator("[data-slate-editor] img")).toHaveCount(1);
  });

  // Open with: a document another app opens with Netherstone is imported and shown.
  await step("open-with", async () => {
    const note = path.join(OUT, OPENED_NOTE);
    fs.writeFileSync(note, `# Opened note\n\n${OPENED_TEXT}\n`);
    const link = await providedFile(OPENED_NOTE, note);
    await shell(`am start -a android.intent.action.VIEW -t text/markdown -d ${link} -n ${ACTIVITY}`);
    await expect(page.getByText(`Imported ${OPENED_NOTE}`)).toBeVisible();
    await expect(page.locator("[data-slate-editor]")).toContainText(OPENED_TEXT);
    await expect
      .poll(() => readAppFile(`${vault}/${OPENED_NOTE}`), { message: "the imported shard" })
      .toContain(OPENED_TEXT);
  });

  // Back from the imported shard shows the shard it was opened over again.
  await step("back-to-previous-file", async () => {
    await page.getByRole("button", { name: "Back", exact: true }).first().click();
    const editor = page.locator("[data-slate-editor]");
    await expect(editor).toContainText(SHARED_TITLE);
    await expect(editor).not.toContainText(OPENED_TEXT);
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
