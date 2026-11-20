import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import {
  caretAfter,
  editor,
  expect,
  lastSave,
  mockVault,
  openShard,
  test,
} from "./vault";

/**
 * Voice notes, recorded from Chromium's fake microphone, which plays a
 * steady tone from a file. Each check waits for what the page shows, never
 * for time to pass.
 */

const TONE_RATE = 48_000;
const TONE_HZ = 440;
const TONE_SECONDS = 2;

/** A 16-bit mono WAV file of `samples`. */
function wavOf(samples: Int16Array, rate: number): Buffer {
  const data = Buffer.from(samples.buffer);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const tone = new Int16Array(TONE_RATE * TONE_SECONDS).map((_, index) =>
  Math.round(Math.sin((2 * Math.PI * TONE_HZ * index) / TONE_RATE) * 0x3fff),
);
const TONE_FILE = join(mkdtempSync(join(tmpdir(), "voice-notes-")), "tone.wav");
writeFileSync(TONE_FILE, wavOf(tone, TONE_RATE));

test.use({
  launchOptions: {
    executablePath: process.env.E2E_CHROMIUM,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${TONE_FILE}`,
    ],
  },
});

const block = (page: Page) => page.getByRole("group", { name: "Voice note recording" });
const timer = (page: Page) => block(page).getByRole("timer");

/** A tenth of a second of silence, as a WAV file. */
const silence = () => wavOf(new Int16Array(TONE_RATE / 10), TONE_RATE);

async function openVault(page: Page, files: Record<string, string> = {}) {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  await mockVault(page, {
    files: { "Standup.md": "# Standup\n\nNotes from Monday.\n", ...files },
    open: "Standup.md",
  });
  await expect(editor(page)).toContainText("Notes from Monday.");
}

async function startFromSlash(page: Page) {
  await caretAfter(page, "Notes from Monday.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/voi");
  await page.getByRole("option", { name: /Voice note/ }).click();
  await expect(block(page).getByRole("button", { name: "Pause" })).toBeVisible();
}

/** The saved clip's bytes, read back from the vault. */
async function savedClip(page: Page): Promise<{ name: string; bytes: number[] }> {
  return page.evaluate(() => {
    const name = Object.keys(window.__binaries).find((key) => key.endsWith(".webm"))!;
    const text = atob(window.__binaries[name]);
    return { name, bytes: Array.from(text, (char) => char.charCodeAt(0)) };
  });
}

test("a voice note records at the cursor and saves as a WebM clip", async ({ page }) => {
  await openVault(page);
  await startFromSlash(page);

  // Focus moves into the block; the timer runs.
  await expect(block(page)).toBeFocused();
  await expect(timer(page)).not.toHaveText("0:00");

  // Still recording, the block never reaches the file.
  await page.keyboard.press("Space");
  await expect(block(page).getByRole("button", { name: "Resume" })).toBeVisible();
  await page.keyboard.press("Space");
  await expect(block(page).getByRole("button", { name: "Pause" })).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(block(page)).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Audio" })).toBeVisible();

  const clip = await savedClip(page);
  expect(clip.name).toMatch(/^_attachments\/Standup voice note \d{4}-\d\d-\d\d \d\d-\d\d\.webm$/);
  // An EBML (WebM) file.
  expect(clip.bytes.slice(0, 4)).toEqual([0x1a, 0x45, 0xdf, 0xa3]);

  await expect
    .poll(() => lastSave(page, "Standup.md"))
    .toContain(`src="${clip.name}"`);
  expect(await lastSave(page, "Standup.md")).not.toContain("voice_recording");

  // The player knows the clip's length from the file.
  await expect(page.getByRole("group", { name: "Audio" })).toContainText(/ \/ 0:0\d/);

  // Undo takes the clip away; Redo brings it back.
  await caretAfter(page, "Notes from Monday.");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByRole("group", { name: "Audio" })).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(page.getByRole("group", { name: "Audio" })).toHaveCount(1);
});

test("discard leaves Undo, which brings the recording back", async ({ page }) => {
  await openVault(page);
  await startFromSlash(page);

  await page.keyboard.press("Escape");
  await expect(block(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(block(page).getByRole("button", { name: "Resume" })).toBeVisible();

  await block(page).getByRole("button", { name: "Discard" }).click();
  await expect(page.getByText("Recording discarded").last()).toBeVisible();
  await expect(block(page)).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(window.__binaries))).toEqual([]);
});

test("the shortcut starts a recording and saves it, and leaving the shard saves too", async ({
  page,
}) => {
  await openVault(page, { "Ideas.md": "# Ideas\n" });
  await caretAfter(page, "Notes from Monday.");

  await page.keyboard.press("ControlOrMeta+Shift+r");
  await expect(block(page).getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+r");
  await expect(page.getByRole("group", { name: "Audio" })).toHaveCount(1);

  // A second start while one runs points to it.
  await caretAfter(page, "Notes from Monday.");
  await page.keyboard.press("ControlOrMeta+Shift+r");
  await expect(block(page).getByRole("button", { name: "Pause" })).toBeVisible();
  await caretAfter(page, "Notes from Monday.");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/voi");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Already recording in Standup")).toBeVisible();

  await openShard(page, "Ideas");
  await expect
    .poll(async () => (await lastSave(page, "Standup.md")).match(/<audio /g)?.length)
    .toBe(2);
});

test("access off shows the cause and a way to turn it on", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await openVault(page);
  await caretAfter(page, "Notes from Monday.");
  await page.keyboard.press("ControlOrMeta+Shift+r");

  await expect(block(page)).toContainText("Microphone access is off for Netherstone");
  await expect(block(page).getByRole("button", { name: "Open system settings" })).toBeVisible();
  await block(page).getByRole("button", { name: "Discard" }).click();
  await expect(block(page)).toHaveCount(0);
});

test("the player plays, changes speed and seeks by keyboard", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  await mockVault(page, {
    files: { "Media.md": '# Media\n\n<audio src="_attachments/tone.wav" />\n' },
    assets: { "_attachments/tone.wav": silence() },
    open: "Media.md",
  });
  const player = page.getByRole("group", { name: "Audio" });
  await expect(player).toContainText("0:00 / 0:00");

  await player.getByRole("button", { name: "Speed 1x" }).click();
  await expect(player.getByRole("button", { name: "Speed 1.5x" })).toBeVisible();
  await player.getByRole("button", { name: "Speed 1.5x" }).click();
  await player.getByRole("button", { name: "Speed 2x" }).click();
  await expect(player.getByRole("button", { name: "Speed 1x" })).toBeVisible();

  await player.getByRole("slider", { name: "Position" }).focus();
  await page.keyboard.press("End");
  await expect(player.getByRole("slider")).toHaveAttribute("aria-valuenow", "0");

  await player.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("menuitem", { name: "Open" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await expect(player).toHaveCount(0);
});

test("Settings › Microphone shows the input, a live level and a test", async ({ page }) => {
  await openVault(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Microphone" }).click();

  await expect(page.getByRole("heading", { name: "Microphone" })).toBeVisible();
  await expect(page.getByRole("combobox")).toContainText("System default");

  // The first test asks for access; the level is live from then on.
  await page.getByRole("button", { name: "Record a test" }).click();
  await expect(page.getByRole("status").filter({ hasText: /^Recording 0:0\d$/ })).toBeVisible();
  await expect(page.locator("[role=meter] [data-lit=true]").first()).toBeAttached();
  await expect(page.getByRole("button", { name: "Play again" })).toBeVisible({ timeout: 20_000 });
});
