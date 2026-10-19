/**
 * Loads pdf.js for reading PDFs. The parser runs in its own worker; the
 * data it may need for some files (character maps for Chinese, Japanese and
 * Korean text, decoders for scanned pages) ships with the app and is handed
 * over on request, so nothing is fetched from the internet.
 */

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let loading: Promise<PdfJs> | null = null;

const CMAPS = import.meta.glob("/node_modules/pdfjs-dist/cmaps/*.bcmap", {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;
// QuickJS runs a PDF's own scripts, which an import never does.
const WASM = import.meta.glob(["/node_modules/pdfjs-dist/wasm/*.{wasm,js}", "!**/quickjs*"], {
  query: "?url",
  import: "default",
}) as Record<string, () => Promise<string>>;

const FOLDERS = { cMapUrl: "cmaps", wasmUrl: "wasm", standardFontDataUrl: "standard_fonts" } as const;

/** Serves pdf.js's data files from the app's own bundle. */
export class BundledDataFactory {
  constructor(_options: unknown) {}

  async fetch({ kind, filename }: { kind: keyof typeof FOLDERS; filename: string }): Promise<Uint8Array> {
    const files = kind === "cMapUrl" ? CMAPS : kind === "wasmUrl" ? WASM : {};
    const load = files[`/node_modules/pdfjs-dist/${FOLDERS[kind]}/${filename}`];
    if (!load) throw new Error(`No ${kind} data for ${filename}`);
    const response = await fetch(await load());
    if (!response.ok) throw new Error(`Couldn't load ${filename}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function loadPdfJs(): Promise<PdfJs> {
  loading ??= (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    if (typeof Worker === "undefined") {
      // No workers (tests): pdf.js runs its parser on this thread instead.
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    } else {
      const { default: workerUrl } = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    }
    return pdfjs;
  })();
  return loading;
}
