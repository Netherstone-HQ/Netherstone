/**
 * Turns Markdown into a preview or a finished file, with no app around it:
 * where the Markdown and its images come from is the caller's. The export
 * window reads them from the vault (`pipeline.ts`); the website's converter
 * from files picked in the browser (`lib/convert/web.ts`).
 */

import { createSlateEditor, normalizeStaticValue } from "platejs";

import { SerializationKit } from "@/components/editor/serialization-kit";
import { deserializeEditorMarkdown } from "@/lib/editor-markdown";
import { deserializeMarkdownInWorker } from "@/lib/editor-markdown-worker";

import { loadImages, type AssetIO, type ImageMap, type LoadContext } from "./assets";
import { buildExportDocument } from "./build";
import { renderDocx } from "./docx";
import { renderHtmlDocument, renderPreviewDocument } from "./html";
import type { ExportDocument } from "./model";
import type { ExportOptions } from "./options";

export { previewLook } from "./html";

/** A shard read and its images loaded, ready to render any number of times. */
export interface PreparedExport {
  doc: ExportDocument;
  images: ImageMap;
  /** Images the shard shows that couldn't be found. */
  missingImages: number;
  io: AssetIO;
}

const lang = () => navigator.language || "en";

async function fetchAsset(url: string) {
  const response = await fetch(url);
  return new Uint8Array(await response.arrayBuffer());
}

/** Reads Markdown into the editor's value, in the Markdown worker when there is one. */
export function parseMarkdown(markdown: string, filePath: string): Promise<unknown[]> {
  const parseHere = () =>
    normalizeStaticValue(
      deserializeEditorMarkdown(createSlateEditor({ plugins: SerializationKit }), markdown, { filePath }),
    ) as unknown[];
  return deserializeMarkdownInWorker(markdown, { filePath, fallback: parseHere });
}

/** Builds the export model of a value and loads the images it shows. */
export async function prepareValue(
  value: unknown[],
  source: { fileName: string; context: LoadContext; io: AssetIO },
): Promise<PreparedExport> {
  const doc = buildExportDocument(value, { fileName: source.fileName, locale: navigator.language });
  const images = await loadImages(doc.images, source.context, source.io);
  return { doc, images, missingImages: doc.images.length - images.size, io: source.io };
}

/** The export window's preview document, loaded once per window. */
export function renderPreview(prepared: PreparedExport, options: ExportOptions): Promise<string> {
  return renderPreviewDocument(prepared.doc, { images: prepared.images, options, loadAsset: fetchAsset, lang: lang() });
}

/** A web page. */
export function renderWebPage(prepared: PreparedExport, options: ExportOptions): Promise<string> {
  return renderHtmlDocument(prepared.doc, {
    images: prepared.images,
    options,
    mode: "web",
    loadAsset: fetchAsset,
    lang: lang(),
  });
}

/** The page a PDF is printed from, with the paper, margins and page numbers in its `@page` rules. */
export function renderPrintPage(prepared: PreparedExport, options: ExportOptions): Promise<string> {
  return renderHtmlDocument(prepared.doc, {
    images: prepared.images,
    options,
    mode: "print",
    loadAsset: fetchAsset,
    lang: lang(),
  });
}

/** A Word document. */
export function renderWord(prepared: PreparedExport, options: ExportOptions): Promise<Uint8Array> {
  const { doc, images, io } = prepared;
  return renderDocx(doc, { images, options, toPng: io.toPng, lang: lang() });
}
