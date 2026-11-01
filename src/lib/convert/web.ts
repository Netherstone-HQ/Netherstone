/**
 * The converter on netherstone.app: the app's own import and export code,
 * with files picked in a browser instead of a vault. Built on its own
 * (`vite.convert.config.ts`) from main by the Converter workflow, so the
 * website converts the way the app's current code does.
 *
 * Nothing here touches the app's backend. Files come in as browser `File`s
 * and go out as bytes for the page to download.
 */

import { createBrowserAssetIO } from "@/lib/export/assets";
import type { ExportFormat } from "@/lib/export/model";
import type { ExportOptions } from "@/lib/export/options";
import {
  parseMarkdown,
  prepareValue,
  renderPreview,
  renderPrintPage,
  renderWebPage,
  renderWord,
  type PreparedExport,
} from "@/lib/export/render";
import type { ImportProgress } from "@/lib/import/engine";

export { previewLook } from "@/lib/export/html";
export { defaultExportOptions, EXPORT_CHOICES, FORMAT_LABELS } from "@/lib/export/options";
export { getDefaultPageSize } from "@/lib/export/theme";
export { renderPreview, renderPrintPage, type PreparedExport };
export type { ExportFormat, ExportOptions, ImportProgress };

// ── To Markdown ─────────────────────────────────────────────────────────────

/** The formats To Markdown reads, as the app's Import reads them. */
export { IMPORT_FORMATS } from "@/lib/import/formats/list";
export type { ConvertedFiles, ConvertedShard } from "./to-markdown";

/**
 * Converts picked or dropped files to Markdown, as the app's Import does:
 * zip files open like folders, files that link to each other keep their
 * links, and pictures go in `_attachments`. Loads the importers on first use.
 */
export async function toMarkdown(...args: Parameters<typeof import("./to-markdown").toMarkdown>) {
  return (await import("./to-markdown")).toMarkdown(...args);
}

/** A zip of `entries`, by path inside it. */
export async function zipFiles(...args: Parameters<typeof import("./to-markdown").zipFiles>) {
  return (await import("./to-markdown")).zipFiles(...args);
}

// ── From Markdown ───────────────────────────────────────────────────────────

/** A picture added beside the Markdown, by its path in a picked folder or its name. */
export interface Picture {
  file: File;
  relativePath?: string;
}

const slashes = (path: string) => path.replace(/\\/g, "/").replace(/^\.?\//, "");

/** Finds the added picture an image path means: by its whole path, else its end, else its name. */
function pictureFinder(pictures: Picture[]) {
  const listed = pictures.map((picture) => ({ picture, path: slashes(picture.relativePath || picture.file.name) }));
  return (wanted: string) => {
    const path = slashes(wanted);
    const lower = path.toLowerCase();
    const name = lower.split("/").pop();
    return (
      listed.find((entry) => entry.path.toLowerCase() === lower) ??
      listed.find((entry) => lower.endsWith(`/${entry.path.toLowerCase()}`)) ??
      listed.find((entry) => entry.path.toLowerCase().split("/").pop() === name)
    )?.picture;
  };
}

async function fetchPicture(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Reads Markdown and loads the pictures it shows, ready for the preview and
 * any number of downloads. Pictures come from `pictures`; pictures on the
 * web are fetched, and ones their site won't share count as missing.
 */
export async function prepareMarkdown(
  markdown: string,
  source: { fileName: string; pictures?: Picture[] },
): Promise<PreparedExport> {
  // The Markdown sits at the root of the picked files, like a shard at a vault's root.
  const shardPath = `${source.fileName}.md`;
  const find = pictureFinder(source.pictures ?? []);
  const io = createBrowserAssetIO(async (path) => {
    const picture = find(path);
    if (!picture) throw new Error(`Not added: ${path}`);
    return new Uint8Array(await picture.file.arrayBuffer());
  }, fetchPicture);
  return prepareValue(await parseMarkdown(markdown, shardPath), {
    fileName: source.fileName,
    context: { vaultPath: null, shardPath },
    io,
  });
}

/** The picture paths in a prepared document that weren't found. */
export function missingPictures(prepared: PreparedExport): string[] {
  return prepared.doc.images.filter((image) => !prepared.images.has(image.id)).map((image) => image.source);
}

const MIME: Record<Exclude<ExportFormat, "pdf">, string> = {
  html: "text/html",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const EXTENSIONS: Record<ExportFormat, string> = { pdf: "pdf", docx: "docx", html: "html" };

/** The file extension each format downloads as. */
export const extensionFor = (format: ExportFormat) => EXTENSIONS[format];

/**
 * A Word document or web page, made here in the browser. PDFs are printed
 * on the website's server from `renderPrintPage`.
 */
export async function renderDownload(
  prepared: PreparedExport,
  options: ExportOptions & { format: "docx" | "html" },
): Promise<Blob> {
  const content =
    options.format === "html" ? await renderWebPage(prepared, options) : await renderWord(prepared, options);
  return new Blob([content as BlobPart], { type: MIME[options.format] });
}
