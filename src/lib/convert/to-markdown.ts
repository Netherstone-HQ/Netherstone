/**
 * To Markdown for the website's converter: the app's Import over files picked
 * in a browser. Loaded only when the page converts files to Markdown, so
 * From Markdown doesn't download the importers.
 */

import JSZip from "jszip";

import { runImport, type ImportIO, type ImportProgress, type ImportSource } from "@/lib/import/engine";
import { serializeImported } from "@/lib/import/serialize";

/** The folder Netherstone keeps attachments in, at a vault's root. */
const ATTACHMENTS = "_attachments";

export interface ConvertedShard {
  /** The file it came from, as picked: `Report.docx`, `Notes.zip/Plan.md`. */
  source: string;
  /** Where it goes in a download: `Report.md`. */
  path: string;
  format: string;
  markdown: string;
  warnings: string[];
  /** The attachments it links to, by path in a download. */
  attachments: string[];
}

export interface ConvertedFiles {
  shards: ConvertedShard[];
  /** Every attachment, by path in a download: `_attachments/photo.png`. */
  attachments: Map<string, Uint8Array>;
  /** Files that aren't documents the app reads, by name. */
  skipped: string[];
  failed: { source: string; error: string }[];
  cancelled: boolean;
}

/** Windows and macOS compare names without case, so downloads unzip cleanly there. */
const nameKey = (path: string) => path.toLowerCase();

function splitName(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { stem: name.slice(0, dot), extension: name.slice(dot) } : { stem: name, extension: "" };
}

/** A name every desktop system can hold, as the app names attachments. */
function portableStem(stem: string) {
  // eslint-disable-next-line no-control-regex
  const cleaned = stem.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim().replace(/[. ]+$/, "");
  return cleaned && !cleaned.startsWith(".") ? cleaned : `attachment${cleaned}`;
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The engine's IO over picked files, keeping what it writes in memory. */
function memoryImportIO(files: Map<string, File>) {
  const shards = new Map<string, string>();
  const attachments = new Map<string, Uint8Array>();
  const taken = new Set<string>();
  /** Attachments by content, so the same picture is stored once. */
  const byContent = new Map<string, string>();

  const fileAt = (path: string) => {
    const file = files.get(path);
    if (!file) throw new Error(`Not a picked file: ${path}`);
    return file;
  };

  const io: ImportIO = {
    readFile: async (path) => new Uint8Array(await fileAt(path).arrayBuffer()),
    readRange: async (path, offset, length) =>
      new Uint8Array(await fileAt(path).slice(offset, offset + length).arrayBuffer()),
    // Free names the way the app picks them: `Name.md`, then `Name_1.md`.
    reservePaths: async (_targetDir, relativePaths) =>
      relativePaths.map((relative) => {
        let candidate = `${relative}.md`;
        for (let counter = 1; taken.has(nameKey(candidate)); counter += 1) candidate = `${relative}_${counter}.md`;
        taken.add(nameKey(candidate));
        return candidate;
      }),
    // Reserved paths stay free in memory, so a shard always goes where it was reserved.
    saveShard: async (path, markdown) => {
      shards.set(path, markdown);
      return path;
    },
    // Called only when a shard went somewhere other than its reserved path, which saveShard never does.
    fixLinks: async () => {},
    saveAttachment: async (name, bytes) => {
      const key = await digest(bytes);
      const existing = byContent.get(key);
      if (existing) return existing;
      const { stem, extension } = splitName(name.replace(/\\/g, "/").split("/").pop() || "attachment");
      const base = portableStem(stem);
      let path = `${ATTACHMENTS}/${base}${extension}`;
      for (let n = 1; taken.has(nameKey(path)); n += 1) path = `${ATTACHMENTS}/${base}-${n}${extension}`;
      taken.add(nameKey(path));
      attachments.set(path, bytes);
      byContent.set(key, path);
      return path;
    },
    // The browser holds everything in memory; there is no vault disk to fill.
    freeSpace: async () => Number.POSITIVE_INFINITY,
    serialize: serializeImported,
    yield: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
  return { io, shards, attachments };
}

/** Whether `markdown` links to the attachment at `path`, written plain or URL-encoded. */
function linksTo(markdown: string, path: string) {
  return markdown.includes(path) || markdown.includes(encodeURI(path));
}

/**
 * Converts picked or dropped files to Markdown, as the app's Import does:
 * zip files open like folders, files that link to each other keep their
 * links, and pictures go in `_attachments`.
 */
export async function toMarkdown(
  picked: { file: File; relativePath?: string }[],
  options: { onProgress?: (progress: ImportProgress) => void; signal?: AbortSignal } = {},
): Promise<ConvertedFiles> {
  const files = new Map<string, File>();
  const sources: ImportSource[] = picked.map(({ file, relativePath }, index) => {
    const path = `picked:${index}/${relativePath || file.name}`;
    files.set(path, file);
    return { path, relativePath: relativePath || file.name, size: file.size };
  });

  const { io, shards, attachments } = memoryImportIO(files);
  const report = await runImport({ sources, targetDir: "", io, onProgress: options.onProgress, signal: options.signal });

  return {
    shards: report.created.map((created) => {
      const markdown = shards.get(created.path) ?? "";
      return {
        source: created.source,
        path: created.path,
        format: created.format,
        markdown,
        warnings: created.warnings,
        attachments: [...attachments.keys()].filter((path) => linksTo(markdown, path)),
      };
    }),
    attachments,
    skipped: report.skipped,
    failed: report.failed,
    cancelled: report.cancelled,
  };
}

/** A zip of `entries`, by path inside it. */
export function zipFiles(entries: Iterable<[path: string, content: string | Uint8Array]>): Promise<Blob> {
  const zip = new JSZip();
  for (const [path, content] of entries) zip.file(path, content);
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}
