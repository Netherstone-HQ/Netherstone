import { invoke } from "@tauri-apps/api/core";
import { assertTauri } from "./tauri";

export type ExportFileFormat = "html" | "pdf" | "docx";

/**
 * Asks where to save an export. Returns the path, with the format's
 * extension, or null if the user cancelled.
 */
export async function chooseExportPath(
  defaultName: string,
  format: ExportFileFormat,
  defaultDirectory?: string | null,
): Promise<string | null> {
  assertTauri();
  return invoke<string | null>("choose_export_path", {
    defaultName,
    format,
    defaultDirectory: defaultDirectory ?? null,
  });
}

/** Writes a finished export to `path`, replacing any file there. */
export async function writeExportFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  assertTauri();
  await invoke("write_export_file", bytes, {
    headers: { "x-export-path": encodeURIComponent(path) },
  });
}

/** Reads a file on this computer that an export embeds. */
export async function readExportAsset(path: string): Promise<Uint8Array> {
  assertTauri();
  return new Uint8Array(await invoke<ArrayBuffer>("read_export_asset", { path }));
}

/** Downloads an image from the web that an export embeds. */
export async function fetchExportAsset(url: string): Promise<Uint8Array> {
  assertTauri();
  return new Uint8Array(await invoke<ArrayBuffer>("fetch_export_asset", { url }));
}

/** Paper and margins of a PDF export, in millimetres. */
export interface PdfPageSetup {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
}

/** Prints an export's HTML to a PDF at `path` through the system webview. */
export async function exportPdf(html: string, path: string, page: PdfPageSetup): Promise<void> {
  assertTauri();
  await invoke("export_pdf", new TextEncoder().encode(html), {
    headers: {
      "x-export-path": encodeURIComponent(path),
      "x-export-page": encodeURIComponent(JSON.stringify(page)),
    },
  });
}
