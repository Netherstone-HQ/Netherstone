/**
 * The export window's side of an export: reads the shard and its images
 * from the vault and writes the file where the person chose. Loaded only
 * when the export window opens: the Word library, the highlighter and the
 * export fonts stay out of startup.
 */

import { exportPdf, fetchExportAsset, readExportAsset, readMarkdownFile, writeExportFile } from "@/lib/commands";

import { createBrowserAssetIO } from "./assets";
import type { ExportOptions } from "./options";
import { parseMarkdown, prepareValue, renderPrintPage, renderWebPage, renderWord, type PreparedExport } from "./render";
import { pageGeometry } from "./theme";

export { previewLook, renderPreview, type PreparedExport } from "./render";

export interface ExportSource {
  /** The shard on disk. */
  filePath: string;
  /** Its name without extension. */
  fileName: string;
  /** The open editor's value, with edits not yet saved; read from disk if absent. */
  value?: unknown[];
  vaultPath: string | null;
}

async function loadValue(source: ExportSource): Promise<unknown[]> {
  if (source.value) return source.value;
  return parseMarkdown(await readMarkdownFile(source.filePath), source.filePath);
}

export async function prepareExport(source: ExportSource): Promise<PreparedExport> {
  return prepareValue(await loadValue(source), {
    fileName: source.fileName,
    context: { vaultPath: source.vaultPath, shardPath: source.filePath },
    io: createBrowserAssetIO(readExportAsset, fetchExportAsset),
  });
}

/** Writes the export to `outputPath`. */
export async function writeExport(
  prepared: PreparedExport,
  options: ExportOptions,
  outputPath: string,
): Promise<void> {
  switch (options.format) {
    case "html": {
      const html = await renderWebPage(prepared, options);
      await writeExportFile(outputPath, new TextEncoder().encode(html));
      return;
    }
    case "docx": {
      await writeExportFile(outputPath, await renderWord(prepared, options));
      return;
    }
    case "pdf": {
      const html = await renderPrintPage(prepared, options);
      return exportPdf(html, outputPath, pageGeometry(options.pageSize, options.margins));
    }
  }
}
