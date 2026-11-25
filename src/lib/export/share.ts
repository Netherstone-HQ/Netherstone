// Sharing an export from a phone through Android's share sheet. A PDF goes
// through the print screen instead.

import { shareExportPath } from "@/lib/commands/export";
import { useSettingsStore } from "@/store";

import type { ExportFormat } from "@/lib/export";
import { defaultExportOptions, loadExportOptions } from "./options";
import { prepareExport, writeExport, type ExportSource } from "./pipeline";
import { renderPrintPage } from "./render";
import { pageGeometry } from "./theme";
import { androidBridge } from "@/lib/android-bridge";

/** What each format's file is, for the apps that receive it. */
const MIME_TYPES: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
};

/** Builds `source` as `format` with the last export look and shares it. */
export async function shareExport(source: ExportSource, format: ExportFormat) {
  const bridge = androidBridge();
  if (!bridge) throw new Error("Sharing works on Android only.");
  const { readingFont, textSize } = useSettingsStore.getState();
  const options = {
    ...loadExportOptions(defaultExportOptions({ readingFont, textSize })),
    format,
  };
  const prepared = await prepareExport(source);
  if (format === "pdf") {
    // Android's print screen makes the PDF, and can print it too.
    const html = await renderPrintPage(prepared, options);
    const geometry = { pageSize: options.pageSize, ...pageGeometry(options.pageSize, options.margins) };
    bridge.printPage(html, source.fileName, JSON.stringify(geometry));
    return;
  }
  const path = await shareExportPath(source.fileName, format);
  await writeExport(prepared, options, path);
  bridge.shareFile(path, MIME_TYPES[format]);
}
