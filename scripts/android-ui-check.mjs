#!/usr/bin/env node
// Drives the Android app on an emulator the way a person would: taps and
// typing go through Android (adb input), the page is only read over
// DevTools. Goes through onboarding, creates a shard, types into it, checks
// the file on disk, then restarts the app, opens the shard and checks the
// text is back. Writes screenshots and a log to the output folder.
//
//   APK=app.apk node scripts/android-ui-check.mjs out
//
// The APK must be built with ORG_GRADLE_PROJECT_netherstoneInspectable=true
// so DevTools can read the page. Waits are on the page's own signals, each
// with a limit so a stuck step fails with what was on screen.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PACKAGE = "tech.blueblood.netherstone";
const ACTIVITY = `${PACKAGE}/.MainActivity`;
const OUT = process.argv[2] ?? "android-ui-check";
const SHARD = "android-check";
const TYPED = "typed on the emulator";

fs.mkdirSync(OUT, { recursive: true });
const adb = (...args) =>
  execFileSync("adb", args, { encoding: "utf8", maxBuffer: 64 << 20 }).trim();
const shell = (command) => adb("shell", command);
const log = (...parts) => console.log(new Date().toISOString().slice(11, 23), ...parts);

// ---- DevTools ----

let socket;
let nextId = 1;
const replies = new Map();

async function connect() {
  const pid = shell(`pidof ${PACKAGE}`).split(/\s+/)[0];
  if (!pid) throw new Error("The app isn't running");
  const name = shell("cat /proc/net/unix").match(
    new RegExp(`@(webview_devtools_remote_${pid})\\b`),
  )?.[1];
  if (!name) throw new Error("The app's WebView has no DevTools socket; was it built inspectable?");
  adb("forward", "tcp:9222", `localabstract:${name}`);
  const targets = await (await fetch("http://127.0.0.1:9222/json")).json();
  const page = targets.find((target) => target.type === "page");
  if (!page) throw new Error("No page in the app's WebView");
  socket?.close();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    replies.get(message.id)?.(message);
    replies.delete(message.id);
  };
}

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    replies.set(id, (message) =>
      message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result),
    );
    socket.send(JSON.stringify({ id, method, params }));
  });
}

/** Runs `body` in the page and returns its value. */
async function page(body) {
  const result = await send("Runtime.evaluate", {
    expression: `(async () => { ${PAGE_HELPERS}\n${body} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result.value;
}

// How long one wait may take before the check fails and says what the
// screen showed. Far above any wait seen, so only a stuck step hits it.
const WAIT_LIMIT_MS = 60_000;

// In the page: waits for a condition by watching the DOM change.
const PAGE_HELPERS = `
  const visible = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const screenText = () => [...document.querySelectorAll("button, h1, h2, [role=menuitem]")].filter(visible).map((el) => el.getAttribute("aria-label") || el.textContent.trim()).filter(Boolean).slice(0, 40).join(" | ");
  const waitFor = (check) => new Promise((resolve, reject) => {
    const done = () => { const value = check(); if (value) { observer.disconnect(); clearTimeout(limit); resolve(value); return true; } return false; };
    const observer = new MutationObserver(done);
    const limit = setTimeout(() => { observer.disconnect(); reject(new Error("Waited " + ${WAIT_LIMIT_MS} + " ms for: " + check.toString() + "\\nOn screen: " + screenText())); }, ${WAIT_LIMIT_MS});
    if (!done()) observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  const byText = (selector, text) => [...document.querySelectorAll(selector)].find((el) => visible(el) && el.textContent.trim() === text);
  const startingWith = (selector, text) => [...document.querySelectorAll(selector)].find((el) => visible(el) && el.textContent.trim().startsWith(text));
`;

async function screenshot(name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, "base64"));
}

// ---- Android input ----

/**
 * Where the WebView's top left corner is on the screen, in pixels: below the
 * status bar unless the app draws behind it. Read from Android's own view of
 * the window.
 */
let origin;
function webViewOrigin() {
  shell("uiautomator dump /data/local/tmp/ui.xml");
  const match = shell("cat /data/local/tmp/ui.xml").match(
    /class="android\.webkit\.WebView"[^>]*?bounds="\[(\d+),(\d+)\]/,
  );
  if (!match) throw new Error("Android shows no WebView on screen");
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Taps the middle of the element `find` (page code) returns, as a finger would. */
async function tap(what, find) {
  const box = await page(`
    const el = await waitFor(() => { const el = (${find})(); return visible(el) ? el : null; });
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: (r.left + r.width / 2) * devicePixelRatio, y: (r.top + r.height / 2) * devicePixelRatio };`);
  origin ??= webViewOrigin();
  const x = Math.round(origin.x + box.x);
  const y = Math.round(origin.y + box.y);
  log("tap", what, `at ${x},${y}`);
  shell(`input tap ${x} ${y}`);
}

function type(text) {
  log("type", JSON.stringify(text));
  shell(`input text '${text.replaceAll(" ", "%s")}'`);
}

/** Starts the app and returns once its WebView can be inspected. */
function launch() {
  shell(`am force-stop ${PACKAGE}`);
  shell("wm dismiss-keyguard");
  origin = undefined;
  adb("logcat", "-c");
  shell(`am start -n ${ACTIVITY}`);
  // The WebView comes after the first frame; MainActivity logs when it's ready.
  adb("logcat", "-m", "1", "-s", "Netherstone:I", "-e", "WebView inspectable");
}

// ---- The check ----

const steps = [];
async function step(name, run) {
  log("==", name);
  try {
    await run();
    steps.push({ name, ok: true });
    await screenshot(`${String(steps.length).padStart(2, "0")}-${name}`);
  } catch (error) {
    steps.push({ name, ok: false, error: String(error?.stack ?? error) });
    const failed = `${String(steps.length).padStart(2, "0")}-${name}-failed`;
    await screenshot(failed).catch(() => {});
    // The whole screen as Android drew it, in case something covers the app.
    fs.writeFileSync(
      path.join(OUT, `${failed}-screen.png`),
      execFileSync("adb", ["exec-out", "screencap", "-p"], { maxBuffer: 64 << 20 }),
    );
    throw error;
  }
}

const APK = process.env.APK;
if (!APK) throw new Error("Set APK to the APK to install");

let vault;
let shardFile;
try {
  adb("install", "-r", "-g", APK);
  launch();
  await connect();

  // The app has drawn its first screen: the welcome tour or, once that's
  // done, the sidebar.
  const appDrawn = `await waitFor(() => window.__TAURI_INTERNALS__ && (startingWith("button", "Get started") || document.querySelector('[data-sidebar="sidebar"]'))); return 1;`;
  await step("app-loads", () => page(appDrawn));

  await step("onboarding", async () => {
    // The way forward on each step, in this order: the vault step's create
    // button shows once its card is open, and sync and the assistant are
    // skipped. A new vault goes in the app's storage. The tour is over once
    // the app's sidebar is up.
    const forward = ["Get started", "Create vault", "Create a new vault", "Continue", "Skip for now", "Open Netherstone"];
    for (;;) {
      const next = await page(`
        const done = () => !!document.querySelector('[data-sidebar="sidebar"]');
        // A forward button that's turned off means the step is busy (a vault
        // being made, say): wait for it rather than tap something else.
        const shown = () => ${JSON.stringify(forward)}.map((t) => [t, startingWith("button", t)]).filter(([, el]) => el);
        const pick = () => { if (done()) return "done"; const now = shown(); return now.some(([, el]) => el.disabled) ? null : now[0]?.[0]; };
        return await waitFor(pick);`);
      if (next === "done") break;
      const before = await page(`return document.body.innerText.length + ":" + document.querySelector('[aria-label^="Step "]')?.getAttribute("aria-label");`);
      await tap(next, `() => startingWith("button", ${JSON.stringify(next)})`);
      await page(`await waitFor(() => (document.body.innerText.length + ":" + document.querySelector('[aria-label^="Step "]')?.getAttribute("aria-label")) !== ${JSON.stringify(before)}); return 1;`);
    }
    vault = await page(`return JSON.parse(localStorage.getItem("netherstone-vault")).state.currentVaultPath;`);
    log("vault", vault);
  });

  await step("create-shard", async () => {
    await tap("New", `() => document.querySelector('button[aria-label="New"]')`);
    await tap("New shard", `() => byText('[role="menuitem"]', "New shard")`);
    await page(`await waitFor(() => document.activeElement?.id === "shard-name"); return 1;`);
    type(SHARD);
    await page(`await waitFor(() => document.getElementById("shard-name")?.value === ${JSON.stringify(SHARD)}); return 1;`);
    await tap("Create shard", `() => byText("button", "Create shard")`);
    await page(`await waitFor(() => !document.getElementById("shard-name") && document.querySelector("[data-slate-editor]")?.textContent.includes(${JSON.stringify(SHARD)})); return 1;`);
    shardFile = `${vault}/${SHARD}.md`;
    const onDisk = shell(`cat '${shardFile}'`);
    if (!onDisk.includes(`# ${SHARD}`)) throw new Error(`The new shard's file holds: ${onDisk}`);
  });

  await step("type-and-save", async () => {
    // Resolves once the app has saved the typed text to disk.
    await page(`
      const internals = window.__TAURI_INTERNALS__;
      const invoke = internals.invoke.bind(internals);
      window.__saved = new Promise((resolve) => {
        internals.invoke = async (command, args, options) => {
          const result = await invoke(command, args, options);
          if (command === "save_markdown_file" && args?.content?.includes(${JSON.stringify(TYPED)})) resolve(args.content);
          return result;
        };
      });
      return 1;`);
    await tap("end of the shard", `() => { const blocks = document.querySelectorAll("[data-slate-editor] [data-slate-node=element]"); return blocks[blocks.length - 1]; }`);
    shell("input keyevent KEYCODE_MOVE_END");
    shell("input keyevent KEYCODE_ENTER");
    type(TYPED);
    await page(`await window.__saved; return 1;`);
    const onDisk = shell(`cat '${shardFile}'`);
    if (!onDisk.includes(TYPED)) throw new Error(`The saved file holds: ${onDisk}`);
  });

  await step("reopen", async () => {
    launch();
    await connect();
    await page(appDrawn);
    await tap(SHARD, `() => byText('[data-sidebar="sidebar"] span', ${JSON.stringify(SHARD)})`);
    await page(`await waitFor(() => document.querySelector("[data-slate-editor]")?.textContent.includes(${JSON.stringify(TYPED)})); return 1;`);
  });
} finally {
  fs.writeFileSync(path.join(OUT, "steps.json"), JSON.stringify(steps, null, 1));
  try {
    fs.writeFileSync(path.join(OUT, "logcat.txt"), adb("logcat", "-d", "-v", "time"));
  } catch {}
  socket?.close();
}
log("all steps passed");
