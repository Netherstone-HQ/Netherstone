#!/usr/bin/env node
// Drives the Android app on an emulator the way a person would: goes through
// the welcome tour, creates a shard, types into it, checks the file on disk,
// then restarts the app, opens the shard and checks the text is back.
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
import { _android as android, expect } from "@playwright/test";

const PACKAGE = "tech.blueblood.netherstone";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const OUT = process.argv[2] ?? "android-ui-check";
const APK = process.env.APK;
const SHARD = "android-check";
const TYPED = "typed on the emulator";

// How long one wait may take. Far above any step on a CI emulator, so only a
// stuck step reaches it.
const WAIT_LIMIT_MS = Number(process.env.WAIT_LIMIT_MS ?? 60_000);

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

// ---- The app ----

const [device] = await android.devices({ omitDriverInstall: true });
if (!device) throw new Error("No Android device or emulator is connected");
device.setDefaultTimeout(WAIT_LIMIT_MS);

const shell = async (command) => (await device.shell(command)).toString().trim();

/** Reads a file in the app's private storage (the emulator image allows root). */
const readAppFile = (file) => shell(`su 0 cat '${file}'`);

let webView;
let page;

/** Starts the app fresh and attaches to its page once it's there. */
async function launch() {
  if (webView) {
    const closed = webView.waitForEvent("close");
    await shell(`am force-stop ${PACKAGE}`);
    await closed;
  }
  await shell(`am start -W -n ${ACTIVITY}`);
  webView = await device.webView({ pkg: PACKAGE });
  page = await webView.page();
  page.setDefaultTimeout(WAIT_LIMIT_MS);
  page.on("pageerror", (error) => log("page error:", error.message));
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

    await expect(page.locator('[data-sidebar="sidebar"]')).toBeVisible();
    vault = await page.evaluate(
      () => JSON.parse(localStorage.getItem("netherstone-vault")).state.currentVaultPath,
    );
    log("vault", vault);
  });

  await step("create-shard", async () => {
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.getByRole("menuitem", { name: "New shard" }).click();
    const name = page.locator("#shard-name");
    await expect(name).toBeFocused();
    await page.keyboard.type(SHARD);
    await expect(name).toHaveValue(SHARD);
    await page.getByRole("button", { name: "Create shard" }).click();
    await expect(name).toBeHidden();

    shardFile = `${vault}/${SHARD}.md`;
    await expect.poll(() => readAppFile(shardFile), { message: `${shardFile} on disk` }).toContain(`# ${SHARD}`);
  });

  await step("type-and-save", async () => {
    const editor = page.locator("[data-slate-editor]");
    await expect(editor).toContainText(SHARD);
    // Until the app has a phone layout, both sidebars leave the shard no
    // room on a phone screen, so close them as a person would.
    await page.getByRole("button", { name: "Hide left sidebar" }).click();
    await page.getByRole("button", { name: "Hide right sidebar" }).click();
    await editor.locator("[data-slate-node=element]").last().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(TYPED);
    await expect(editor).toContainText(TYPED);
    await expect.poll(() => readAppFile(shardFile), { message: `${shardFile} on disk` }).toContain(TYPED);
  });

  await step("reopen", async () => {
    await launch();
    // The left sidebar comes back as it was left: closed.
    await page.getByRole("button", { name: "Show left sidebar" }).click();
    const sidebar = page.locator('[data-sidebar="sidebar"]');
    await sidebar.getByText(SHARD, { exact: true }).first().click();
    await expect(page.locator("[data-slate-editor]")).toContainText(TYPED);
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
