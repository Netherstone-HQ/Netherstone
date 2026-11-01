/**
 * The formats the import reads, by name. Plain data with no imports, so
 * build tools can read it too: the website's converter makes a page for
 * each one (vite.convert.config.ts).
 */

export interface FormatInfo {
  /** Names the format in the summary and the Import window: `Word`. */
  label: string;
  /** Lowercase extensions without the dot. */
  extensions: string[];
}

export const IMPORT_FORMATS = {
  docx: { label: "Word", extensions: ["docx", "docm", "dotx"] },
  pdf: { label: "PDF", extensions: ["pdf"] },
  markdown: { label: "Markdown", extensions: ["md", "markdown", "mdown", "mkd"] },
  html: { label: "Web page", extensions: ["html", "htm", "xhtml"] },
  text: { label: "Text", extensions: ["txt", "text"] },
  csv: { label: "CSV", extensions: ["csv", "tsv"] },
} satisfies Record<string, FormatInfo>;
