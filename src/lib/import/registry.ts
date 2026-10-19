import { csvImporter } from "./formats/csv";
import { docxImporter } from "./formats/docx";
import { htmlImporter } from "./formats/html";
import { markdownImporter } from "./formats/markdown";
import { pdfImporter } from "./formats/pdf";
import { textImporter } from "./formats/text";
import { unsupportedImporters } from "./formats/unsupported";
import type { Importer } from "./types";

/** Every format the engine reads. A new format is one more entry here. */
export const IMPORTERS: Importer[] = [
  docxImporter,
  pdfImporter,
  markdownImporter,
  htmlImporter,
  textImporter,
  csvImporter,
];

const BY_EXTENSION = new Map<string, Importer>();
for (const importer of [...IMPORTERS, ...unsupportedImporters]) {
  for (const extension of importer.extensions) BY_EXTENSION.set(extension, importer);
}

export function importerFor(fileName: string): Importer | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) return null;
  return BY_EXTENSION.get(fileName.slice(dot + 1).toLowerCase()) ?? null;
}
