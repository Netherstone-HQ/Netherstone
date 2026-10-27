// Draws the installer images from the brand mark and wordmark in index.html
// (the splash's own paths), so they follow the brand when it changes:
//   node scripts/installer-images.mjs
// Writes src-tauri/installer/: the Windows installer's sidebar and header
// (BMP, the only format NSIS takes) and the macOS disk image background
// (a TIFF holding a 1x and a 2x image; Finder picks one for the screen).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "src-tauri", "installer");
const config = JSON.parse(readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"));
const dmg = config.bundle.macOS.dmg;

const html = readFileSync(join(root, "index.html"), "utf8");
const svg = (className) => {
  const found = html.match(new RegExp(`<svg class="${className}"[\\s\\S]*?</svg>`));
  if (!found) throw new Error(`index.html has no ${className}`);
  return found[0].replace(/ class="[^"]*"/, "");
};
const mark = svg("splash-mark");
const wordmark = svg("splash-wordmark");
// The wordmark's viewBox, for its width at a given height.
const [, , wordmarkWidth, wordmarkHeight] = wordmark.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);

// Basalt palette.
const INK = "#141516";
const BONE = "#EEEBE5";
const STONE = "#8A8780";
const PAPER = "#F6F5F2";
// The Windows installer's header band is the system window colour.
const WINDOW = "#FFFFFF";

// Visible overflow: the round letters reach the viewBox's bottom edge, and
// clipping there flattens them.
const sized = (element, width, height) =>
  element.replace("<svg", `<svg width="${width}" height="${height}" overflow="visible"`);
const coloured = (colour) => wordmark.replace(/fill="[^"]*"/g, `fill="${colour}"`);
// The splash's proportions: the wordmark is this much of the mark's height.
const SPLASH_WORDMARK = 20.22 / 44;

/** The mark above the wordmark, `width` wide, centred. */
const stacked = (width, colour) => {
  const height = width * (wordmarkHeight / wordmarkWidth);
  const markSize = height / SPLASH_WORDMARK;
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:${height}px">
    ${sized(mark, markSize, markSize)}${sized(coloured(colour), width, height)}</div>`;
};

/** The mark beside the wordmark, `markSize` tall, as in the splash. */
const lockup = (markSize, colour) => {
  const height = markSize * SPLASH_WORDMARK;
  return `<div style="display:flex;align-items:center;gap:${markSize / 4}px">
    ${sized(mark, markSize, markSize)}${sized(coloured(colour), height * (wordmarkWidth / wordmarkHeight), height)}</div>`;
};

// NSIS sizes: https://nsis.sourceforge.io/Docs/Modern%20UI%202/Readme.html
// NSIS resizes by dropping or repeating pixels, so they're drawn at exactly
// that size, sharp at 100% scaling.
const images = [
  {
    file: "nsis-sidebar.bmp",
    scales: [1],
    width: 164,
    height: 314,
    body: `<div style="background:${INK};width:100%;height:100%;display:flex;align-items:center;justify-content:center">
      ${stacked(112, BONE)}</div>`,
  },
  {
    file: "nsis-header.bmp",
    scales: [1],
    width: 150,
    height: 57,
    body: `<div style="background:${WINDOW};width:100%;height:100%;display:flex;align-items:center;justify-content:flex-end;padding-right:12px;box-sizing:border-box">
      ${sized(mark, 40, 40)}</div>`,
  },
  {
    file: "dmg-background.tiff",
    scales: [1, 2],
    width: dmg.windowSize.width,
    height: dmg.windowSize.height,
    // Finder writes the icon names in dark text, so the window stays light.
    body: `<div style="background:${PAPER};width:100%;height:100%;position:relative">
      <div style="position:absolute;top:36px;width:100%;display:flex;justify-content:center">${lockup(40, INK)}</div>
      ${arrow(dmg.appPosition, dmg.applicationFolderPosition)}
    </div>`,
  },
];

/** A plain arrow from the app to the Applications folder. */
function arrow(from, to) {
  // Clear of the icons, which Finder draws centred on their positions.
  const iconHalf = 64;
  const gap = 24;
  const x1 = from.x + iconHalf + gap;
  const x2 = to.x - iconHalf - gap;
  const head = 8;
  return `<svg style="position:absolute;left:0;top:0" width="100%" height="100%">
    <g stroke="${STONE}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M${x1} ${from.y}H${x2}M${x2 - head} ${from.y - head}L${x2} ${from.y}L${x2 - head} ${from.y + head}"/>
    </g></svg>`;
}

/** 24-bit BMP, bottom row first, rows padded to 4 bytes. */
function bmp({ width, height, rgba }) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const header = 54;
  const file = Buffer.alloc(header + row * height);
  file.write("BM", 0);
  file.writeUInt32LE(file.length, 2);
  file.writeUInt32LE(header, 10);
  file.writeUInt32LE(40, 14);
  file.writeInt32LE(width, 18);
  file.writeInt32LE(height, 22);
  file.writeUInt16LE(1, 26);
  file.writeUInt16LE(24, 28);
  file.writeUInt32LE(row * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = header + (height - 1 - y) * row + x * 3;
      file[to] = rgba[from + 2];
      file[to + 1] = rgba[from + 1];
      file[to + 2] = rgba[from];
    }
  }
  return file;
}

/**
 * A TIFF with one RGB image per scale, deflate-compressed, each marked with
 * its resolution (72 dpi per 1x), the way macOS's `tiffutil -cathidpicheck`
 * writes them.
 */
function tiff(frames) {
  const BASE_DPI = 72;
  const parts = [];
  let offset = 8;
  const add = (buffer) => {
    const at = offset;
    parts.push(buffer);
    offset += buffer.length + (buffer.length % 2);
    if (buffer.length % 2) parts.push(Buffer.alloc(1));
    return at;
  };
  const ifdOffsets = frames.map(({ width, height, rgba, scale }) => {
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) rgba.copy(rgb, i * 3, i * 4, i * 4 + 3);
    const strip = deflateSync(rgb);
    const stripAt = add(strip);
    const bitsAt = add(Buffer.from(new Uint16Array([8, 8, 8]).buffer));
    const resolution = Buffer.alloc(8);
    resolution.writeUInt32LE(BASE_DPI * scale, 0);
    resolution.writeUInt32LE(1, 4);
    const resolutionAt = add(resolution);
    // Tag, type (3 short, 4 long, 5 rational), value.
    const entries = [
      [256, 4, width],
      [257, 4, height],
      [258, 3, bitsAt, 3],
      [259, 3, 8], // deflate
      [262, 3, 2], // RGB
      [273, 4, stripAt],
      [277, 3, 3],
      [278, 4, height],
      [279, 4, strip.length],
      [282, 5, resolutionAt],
      [283, 5, resolutionAt],
      [296, 3, 2], // inches
    ];
    const ifd = Buffer.alloc(2 + entries.length * 12 + 4);
    ifd.writeUInt16LE(entries.length, 0);
    entries.forEach(([tag, type, value, count = 1], i) => {
      const at = 2 + i * 12;
      ifd.writeUInt16LE(tag, at);
      ifd.writeUInt16LE(type, at + 2);
      ifd.writeUInt32LE(count, at + 4);
      if (type === 3 && count === 1) ifd.writeUInt16LE(value, at + 8);
      else ifd.writeUInt32LE(value, at + 8);
    });
    return { ifd, at: add(ifd) };
  });
  // Chain each image to the next.
  ifdOffsets.forEach(({ ifd }, i) => ifd.writeUInt32LE(ifdOffsets[i + 1]?.at ?? 0, ifd.length - 4));
  const header = Buffer.alloc(8);
  header.write("II", 0);
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(ifdOffsets[0].at, 4);
  return Buffer.concat([header, ...parts]);
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const image of images) {
    const frames = [];
    for (const scale of image.scales) {
      const page = await browser.newPage({
        viewport: { width: image.width, height: image.height },
        deviceScaleFactor: scale,
      });
      await page.setContent(`<body style="margin:0;width:${image.width}px;height:${image.height}px">${image.body}</body>`);
      const png = await page.screenshot();
      const rgba = await page.evaluate(async (data) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        context.drawImage(bitmap, 0, 0);
        return Array.from(context.getImageData(0, 0, bitmap.width, bitmap.height).data);
      }, png.toString("base64"));
      frames.push({ width: image.width * scale, height: image.height * scale, rgba: Buffer.from(rgba), scale });
      await page.close();
    }
    writeFileSync(join(out, image.file), image.file.endsWith(".tiff") ? tiff(frames) : bmp(frames[0]));
    console.log(`Wrote src-tauri/installer/${image.file}`);
  }
} finally {
  await browser.close();
}
