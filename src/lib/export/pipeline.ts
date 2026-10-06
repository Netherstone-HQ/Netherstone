/**
 * Turns a shard into a preview or a finished file. Loaded only when the
 * export window opens: the Word library, the highlighter and the export
 * fonts stay out of startup.
 */

import { createSlateEditor, normalizeStaticValue } from "platejs";

import { SerializationKit } from "@/components/editor/serialization-kit";
import { exportPdf, fetchExportAsset, readExportAsset, readMarkdownFile, writeExportFile } from "@/lib/commands";
import { deserializeEditorMarkdown } from "@/lib/editor-markdown";
import { deserializeMarkdownInWorker } from "@/lib/editor-markdown-worker";

import { createBrowserAssetIO, loadImages, type AssetIO, type ImageMap } from "./assets";
import { buildExportDocument } from "./build";
import { renderDocx } from "./docx";
import { renderHtmlDocument, renderPreviewDocument } from "./html";
import type { ExportDocument } from "./model";
import type { ExportOptions } from "./options";
import { pageGeometry } from "./theme";

export { previewLook } from "./html";

export interface ExportSource {
  /** The shard on disk. */
  filePath: string;
  /** Its name without extension. */
  fileName: string;
  /** The open editor's value, with edits not yet saved; read from disk if absent. */
  value?: unknown[];
  vaultPath: string | null;
}

/** A shard read and its images loaded, ready to render any number of times. */
export interface PreparedExport {
  doc: ExportDocument;
  images: ImageMap;
  /** Images the shard shows that couldn't be found. */
  missingImages: number;
  io: AssetIO;
}

const lang = () => navigator.language || "en";

async function loadValue(source: ExportSource): Promise<unknown[]> {
  if (source.value) return source.value;
  const markdown = await readMarkdownFile(source.filePath);
  const parseHere = () =>
    normalizeStaticValue(
      deserializeEditorMarkdown(createSlateEditor({ plugins: SerializationKit }), markdown),
    ) as unknown[];
  return deserializeMarkdownInWorker(markdown, { filePath: source.filePath, fallback: parseHere });
}

async function fetchAsset(url: string) {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

export async function prepareExport(source: ExportSource): Promise<PreparedExport> {
  const value = await loadValue(source);
  const doc = buildExportDocument(value, { fileName: source.fileName, locale: navigator.language });
  const io = createBrowserAssetIO(readExportAsset, fetchExportAsset);
  const images = await loadImages(doc.images, { vaultPath: source.vaultPath, shardPath: source.filePath }, io);
  return { doc, images, missingImages: doc.images.length - images.size, io };
}

/** The export window's preview document, loaded once per window. */
export function renderPreview(prepared: PreparedExport, options: ExportOptions): Promise<string> {
  return renderPreviewDocument(prepared.doc, { images: prepared.images, options, loadAsset: fetchAsset, lang: lang() });
}

/** Writes the export to `outputPath`. */
export async function writeExport(
  prepared: PreparedExport,
  options: ExportOptions,
  outputPath: string,
): Promise<void> {
  const { doc, images, io } = prepared;

  switch (options.format) {
    case "html": {
      const html = await renderHtmlDocument(doc, { images, options, mode: "web", loadAsset: fetchAsset, lang: lang() });
      await writeExportFile(outputPath, new TextEncoder().encode(html));
      return;
    }
    case "docx": {
      const bytes = await renderDocx(doc, { images, options, toPng: io.toPng, lang: lang() });
      await writeExportFile(outputPath, bytes);
      return;
    }
    case "pdf": {
      const html = await renderHtmlDocument(doc, { images, options, mode: "print", loadAsset: fetchAsset, lang: lang() });
      return exportPdf(html, outputPath, pageGeometry(options.pageSize, options.margins));
    }
  }
}
