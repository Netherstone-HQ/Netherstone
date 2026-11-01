/**
 * Turns Markdown into a preview or a finished file, with no app around it:
 * where the Markdown and its images come from is the caller's. The export
 * window reads them from the vault (`pipeline.ts`); the website's converter
 * from files picked in the browser (`lib/convert/web.ts`).
 */

import { deserializeMarkdownInWorker } from "@/lib/editor-markdown-worker";

import { loadImages, type AssetIO, type ImageMap, type LoadContext } from "./assets";
import { buildExportDocument } from "./build";
import { loadHighlighter } from "./highlight";
import { renderHtmlDocument, renderPreviewDocument } from "./html";
import { loadMath } from "./math";
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
  // Only without a worker; the parser loads then, so pages that have one don't download it twice.
  const parseHere = async () => {
    const [{ createSlateEditor, normalizeStaticValue }, { SerializationKit }, { deserializeEditorMarkdown }] =
      await Promise.all([
        import("platejs"),
        import("@/components/editor/serialization-kit"),
        import("@/lib/editor-markdown"),
      ]);
    return normalizeStaticValue(
      deserializeEditorMarkdown(createSlateEditor({ plugins: SerializationKit }), markdown, { filePath }),
    ) as unknown[];
  };
  return deserializeMarkdownInWorker(markdown, { filePath, fallback: parseHere });
}

/** Whether any node in `nodes`, at any depth, is one of `types`. */
function hasNodeOf(nodes: unknown[], types: Set<string>): boolean {
  return nodes.some((node) => {
    if (!node || typeof node !== "object") return false;
    const { type, children } = node as { type?: unknown; children?: unknown };
    return (typeof type === "string" && types.has(type)) || (Array.isArray(children) && hasNodeOf(children, types));
  });
}

const CODE_TYPES = new Set(["code_block"]);
const MATH_TYPES = new Set(["equation", "inline_equation"]);

/** Builds the export model of a value and loads the images it shows. */
export async function prepareValue(
  value: unknown[],
  source: { fileName: string; context: LoadContext; io: AssetIO },
): Promise<PreparedExport> {
  // The highlighter and KaTeX are large and load only for documents that need them.
  await Promise.all([
    hasNodeOf(value, CODE_TYPES) && loadHighlighter(),
    hasNodeOf(value, MATH_TYPES) && loadMath(),
  ]);
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

/** A Word document. The Word writer loads the first time one is made. */
export async function renderWord(prepared: PreparedExport, options: ExportOptions): Promise<Uint8Array> {
  const { doc, images, io } = prepared;
  const { renderDocx } = await import("./docx");
  return renderDocx(doc, { images, options, toPng: io.toPng, lang: lang() });
}
