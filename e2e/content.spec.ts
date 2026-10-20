import type { Page } from "@playwright/test";
import { caretAfter, editor, expect, mockVault, paste, test } from "./vault";

/**
 * Everything a shard, a drawing, an export or an import loads, under the
 * app's security policy. The policy check itself runs after every test (see
 * `test` in ./vault): these make sure each kind of content is loaded at all.
 */

// A 1×1 PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/** A short silent WAV. */
function wav() {
  const samples = 800;
  const bytes = Buffer.alloc(44 + samples);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(8000, 24);
  bytes.writeUInt32LE(8000, 28);
  bytes.writeUInt16LE(1, 32);
  bytes.writeUInt16LE(8, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples, 40);
  bytes.fill(128, 44);
  return bytes;
}

/** A one-page PDF with a heading and a paragraph in the standard fonts. */
function pdf() {
  const content = [
    "BT /F2 22 Tf 72 712 Td (Field notes) Tj ET",
    "BT /F1 11 Tf 72 672 Td (The river was high after the rain.) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** Every URL the page asks for, whether or not it is answered. */
function recordRequests(page: Page) {
  const urls: string[] = [];
  page.on("request", (request) => urls.push(request.url()));
  return urls;
}

const MEDIA = `# Media

![Photo](_attachments/photo.png)

![From the web](https://example.com/web.png)

<audio src="_attachments/tone.wav" />

<video src="_attachments/clip.mp4" />

<video src="https://www.youtube.com/watch?v=aqz-KE-bpKQ" />

$$
e^{i\\pi} + 1 = 0
$$
`;

test("pictures, sound, video, embeds and math in a shard load", async ({ page }) => {
  const requests = recordRequests(page);
  // As in the app, so vault files are shown through the asset protocol.
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  await mockVault(page, {
    files: { "Media.md": MEDIA },
    assets: {
      "_attachments/photo.png": PNG,
      "_attachments/tone.wav": wav(),
      "_attachments/clip.mp4": Buffer.alloc(16),
    },
    open: "Media.md",
  });

  // Vault files come through the asset protocol.
  const photo = editor(page).locator("img[src*='photo.png']");
  await expect(photo).toHaveJSProperty("naturalWidth", 1);
  await expect(editor(page).locator("audio[src*='tone.wav']")).toHaveCount(1);
  await expect.poll(() => requests.some((url) => url.startsWith("http://asset.localhost/") && url.includes("tone.wav"))).toBe(true);
  await expect(editor(page).locator("video[src*='clip.mp4']")).toHaveCount(1);
  await expect.poll(() => requests.some((url) => url.startsWith("http://asset.localhost/") && url.includes("clip.mp4"))).toBe(true);

  // Pictures and videos from the web are asked for (the test answers none).
  await expect.poll(() => requests.includes("https://example.com/web.png")).toBe(true);
  await expect.poll(() => requests.some((url) => hostOf(url).endsWith(".ytimg.com"))).toBe(true);
  await editor(page).locator(".lty-playbtn").click();
  await expect(editor(page).locator("iframe[src*='youtube']")).toHaveCount(1);

  // Math draws with the bundled KaTeX fonts.
  await expect(editor(page).locator(".katex").first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.fonts.check("16px KaTeX_Main"))).toBe(true);
});

test("the light theme styles the editor", async ({ page }) => {
  await mockVault(page, {
    files: { "Light.md": "# Light\n\nSome **bold** text and `code`.\n" },
    open: "Light.md",
    theme: "light",
  });

  await expect(page.locator("html")).not.toHaveClass(/dark/);
  const heading = editor(page).locator("h1");
  await expect(heading).toHaveText("Light");
  const looks = await heading.evaluate((element) => {
    const style = getComputedStyle(element);
    return { size: parseFloat(style.fontSize) };
  });
  expect(looks.size).toBeGreaterThan(20);
  await expect.poll(() => page.evaluate(() => document.fonts.check("16px 'Geist Variable'"))).toBe(true);
});

const DRAWING = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "netherstone",
  elements: [
    {
      id: "text-1",
      type: "text",
      x: 100,
      y: 100,
      width: 120,
      height: 25,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      text: "Hello",
      fontSize: 20,
      fontFamily: 5,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      originalText: "Hello",
      autoResize: true,
      lineHeight: 1.25,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

test("a drawing opens, and adds to a shard as a picture", async ({ page }) => {
  const requests = recordRequests(page);
  await mockVault(page, {
    files: { "Notes.md": "# Notes\n", "Sketch.excalidraw": DRAWING },
    open: "Notes.md",
  });

  await page.getByText("Sketch", { exact: true }).first().click();
  await expect(page.locator(".excalidraw canvas").first()).toBeVisible({ timeout: 30_000 });
  // The hand-drawn font comes from esm.sh, as Excalidraw ships it.
  await expect.poll(() => requests.some((url) => url.startsWith("https://esm.sh/"))).toBe(true);

  // Adding it to a shard draws it as a picture.
  await page.getByRole("button", { name: "Add to shard", exact: true }).click();
  await page.getByRole("option", { name: /Notes/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Add to shard", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__saves.at(-1)?.content ?? ""), { timeout: 30_000 })
    .toContain('data-excalidraw="Sketch.excalidraw"');
});

test("the export preview draws each format, and Word and web pages save", async ({ page }) => {
  await mockVault(page, {
    files: {
      "Report.md": "# Report\n\nA paragraph with **bold** text.\n\n- One\n- Two\n\n$$\nx^2\n$$\n",
    },
    open: "Report.md",
  });

  await page.getByRole("button", { name: "Actions for Report" }).first().click();
  await page.getByRole("menuitem", { name: "Export…" }).click();

  const preview = page.locator("iframe[title='Preview of Report']");
  const formats = page.getByRole("radiogroup", { name: "Format" });
  for (const format of ["PDF", "Word", "Web page"]) {
    await formats.getByRole("radio", { name: new RegExp(format) }).click();
    // The preview shows once its own script has laid it out.
    await expect(preview).toHaveClass(/opacity-100/, { timeout: 30_000 });
    await expect(preview.contentFrame().locator("h1").first()).toHaveText("Report");
    if (format !== "Web page") await expect(page.getByText(/1 page/).first()).toBeVisible();
  }

  // Word documents and web pages are written here; PDFs by the desktop app.
  await page.getByRole("button", { name: "Export web page" }).click();
  await expect.poll(() => page.evaluate(() => window.__exports)).toEqual([
    expect.stringMatching(/^<!doctype html>/i),
  ]);
  await page.getByRole("button", { name: "Actions for Report" }).first().click();
  await page.getByRole("menuitem", { name: "Export…" }).click();
  await formats.getByRole("radio", { name: /Word/ }).click();
  await page.getByRole("button", { name: "Export Word document" }).click();
  await expect.poll(() => page.evaluate(() => window.__exports.at(-1))).toMatch(/^PK/);
});

test("a PDF imports into a shard", async ({ page }) => {
  await mockVault(page, {
    files: { "Notes.md": "# Notes\n" },
    assets: { "Field notes.pdf": pdf() },
    folders: ["Inbox"],
    open: "Notes.md",
  });

  await page.getByText("Inbox", { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Import here…" }).click();
  await page.getByRole("button", { name: /Files/ }).click();

  await expect
    .poll(
      () =>
        page.evaluate(() =>
          window.__saves.find((save) => save.filePath.endsWith("Inbox/Field notes.md")),
        ),
      { timeout: 30_000 },
    )
    .toMatchObject({ content: expect.stringContaining("Field notes") });
  const saved = await page.evaluate(
    () => window.__saves.find((save) => save.filePath.endsWith("Inbox/Field notes.md"))!.content,
  );
  expect(saved).toContain("The river was high after the rain.");
});

/** Runs the shard as the app does, so files are shown through the asset protocol. */
async function asInApp(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
}

/** Drops `data` onto the editor, as a drag from the browser panel does. */
async function drop(page: Page, data: { file?: { name: string; base64: string; type: string }; html?: string; url?: string }) {
  await editor(page).evaluate((element, data) => {
    const transfer = new DataTransfer();
    if (data.file) {
      const bytes = Uint8Array.from(atob(data.file.base64), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], data.file.name, { type: data.file.type }));
    }
    if (data.html) transfer.setData("text/html", data.html);
    if (data.url) transfer.setData("text/uri-list", data.url);
    const box = element.querySelector("h1")!.getBoundingClientRect();
    const at = { clientX: box.left + 5, clientY: box.bottom + 2, bubbles: true, cancelable: true, dataTransfer: transfer };
    element.dispatchEvent(new DragEvent("dragenter", at));
    element.dispatchEvent(new DragEvent("dragover", at));
    element.dispatchEvent(new DragEvent("drop", at));
  }, data);
}

const OUTSIDE = "/home/me/Pictures/cat.png";

test("a picture outside the vault shows when a shard links to it", async ({ page }) => {
  await asInApp(page);
  await mockVault(page, {
    files: { "Cats.md": `# Cats\n\n![Cat](${OUTSIDE})\n` },
    assets: { [OUTSIDE]: PNG },
    open: "Cats.md",
  });

  await expect(editor(page).locator("img[src*='cat.png']")).toHaveJSProperty("naturalWidth", 1);
});

test("a picture outside the vault shows as soon as it is pasted", async ({ page }) => {
  await asInApp(page);
  await mockVault(page, {
    files: { "Cats.md": "# Cats\n\nBelow.\n" },
    assets: { [OUTSIDE]: PNG },
    open: "Cats.md",
  });

  await caretAfter(page, "Below.");
  await page.keyboard.press("Enter");
  await paste(page, { text: `![Pasted cat](${OUTSIDE})` });
  await expect(editor(page).locator("img[src*='cat.png']")).toHaveJSProperty("naturalWidth", 1);
});

test("a picture file pasted or dropped from the browser panel is added and shown", async ({ page }) => {
  await asInApp(page);
  await mockVault(page, { files: { "Cats.md": "# Cats\n\nBelow.\n" }, open: "Cats.md" });

  await drop(page, {
    file: { name: "dropped.png", base64: PNG.toString("base64"), type: "image/png" },
    html: '<img src="https://example.com/dropped.png">',
    url: "https://example.com/dropped.png",
  });
  await expect(editor(page).locator("img[src*='dropped.png']")).toHaveJSProperty("naturalWidth", 1);
  expect(await page.evaluate(() => "_attachments/dropped.png" in window.__binaries)).toBe(true);

  await caretAfter(page, "Below.");
  await page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })]);
  }, PNG.toString("base64"));
  await page.keyboard.press("Control+V");
  await expect(editor(page).locator("img[src*='asset.localhost']")).toHaveCount(2);
  for (const image of await editor(page).locator("img[src*='asset.localhost']").all()) {
    await expect(image).toHaveJSProperty("naturalWidth", 1);
  }
});

test("a web picture dropped from the browser panel as a link shows", async ({ page }) => {
  const requests = recordRequests(page);
  await asInApp(page);
  await mockVault(page, { files: { "Cats.md": "# Cats\n\nBelow.\n" }, open: "Cats.md" });

  await drop(page, {
    html: '<img src="https://example.com/linked.png" alt="Linked cat">',
    url: "https://example.com/linked.png",
  });
  await expect(editor(page).locator("img[src='https://example.com/linked.png']")).toHaveCount(1);
  await expect.poll(() => requests.includes("https://example.com/linked.png")).toBe(true);
});

/** The status each asset protocol request got. */
function recordAssetResponses(page: Page) {
  const statuses = new Map<string, number>();
  page.on("response", (response) => {
    if (response.url().startsWith("http://asset.localhost/")) {
      statuses.set(decodeURIComponent(new URL(response.url()).pathname.slice(1)), response.status());
    }
  });
  return statuses;
}

const SONG = "/home/me/Music/tone.wav";
const CLIP = "/home/me/Videos/clip.mp4";
const REPORT = "/home/me/Documents/Report.pdf";

test("sound, video and other files outside the vault show and open", async ({ page }) => {
  const statuses = recordAssetResponses(page);
  await asInApp(page);
  await mockVault(page, {
    files: {
      "Outside.md": `# Outside\n\n<audio src="${SONG}" />\n\n<video src="${CLIP}" />\n\n<file name="Report.pdf" src="${REPORT}" />\n`,
    },
    assets: { [SONG]: wav(), [CLIP]: Buffer.alloc(16), [REPORT]: pdf() },
    open: "Outside.md",
  });

  await expect(editor(page).locator("audio[src*='tone.wav']")).toHaveCount(1);
  await expect(editor(page).locator("video[src*='clip.mp4']")).toHaveCount(1);
  await expect.poll(() => statuses.get(SONG)).toBe(200);
  await expect.poll(() => statuses.get(CLIP)).toBe(200);

  // Other files aren't served; they open in their own app, as before.
  const file = editor(page).getByText("Report.pdf").first();
  await expect(file).toBeVisible();
  await expect(editor(page).getByText(/missing|not found/i)).toHaveCount(0);
  await file.click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__commands.some(
          ({ command, args }) =>
            command.startsWith("plugin:opener|open_path") &&
            JSON.stringify(args).includes("Report.pdf"),
        ),
      ),
    )
    .toBe(true);
});

test("dropped sound, video and other files are added and show", async ({ page }) => {
  const statuses = recordAssetResponses(page);
  await asInApp(page);
  await mockVault(page, { files: { "Drops.md": "# Drops\n" }, open: "Drops.md" });

  for (const file of [
    { name: "tone.wav", base64: wav().toString("base64"), type: "audio/wav" },
    { name: "clip.mp4", base64: Buffer.alloc(16).toString("base64"), type: "video/mp4" },
    { name: "Report.pdf", base64: pdf().toString("base64"), type: "application/pdf" },
  ]) {
    await drop(page, { file });
    await expect
      .poll(() => page.evaluate((name) => `_attachments/${name}` in window.__binaries, file.name))
      .toBe(true);
  }

  await expect(editor(page).locator("audio[src*='tone.wav']")).toHaveCount(1);
  await expect(editor(page).locator("video[src*='clip.mp4']")).toHaveCount(1);
  await expect(editor(page).getByText("Report.pdf").first()).toBeVisible();
  await expect.poll(() => statuses.get("/home/me/Vault/_attachments/tone.wav")).toBe(200);
  await expect.poll(() => statuses.get("/home/me/Vault/_attachments/clip.mp4")).toBe(200);
});
