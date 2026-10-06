/**
 * The choices in the export window. They start from the reading settings
 * and the computer's region, and the last ones used are remembered.
 */

import type { ReadingFont, TextSize as ReadingTextSize } from "@/store/settings";

import type { ExportFormat } from "./model";
import { getDefaultPageSize, type Margins, type PageSize, type TextSize, type Typeface } from "./theme";

export type HtmlTheme = "light" | "dark";

export interface ExportOptions {
  format: ExportFormat;
  typeface: Typeface;
  textSize: TextSize;
  /** PDF and Word. */
  pageSize: PageSize;
  margins: Margins;
  pageNumbers: boolean;
  /** Web page only. */
  theme: HtmlTheme;
}

const STORAGE_KEY = "netherstone-export-options";

const CHOICES: { [K in keyof ExportOptions]: readonly ExportOptions[K][] } = {
  format: ["pdf", "docx", "html"],
  typeface: ["newsreader", "geist"],
  textSize: ["small", "default", "large"],
  pageSize: ["a4", "letter"],
  margins: ["narrow", "normal", "wide"],
  pageNumbers: [true, false],
  theme: ["light", "dark"],
};

export function defaultExportOptions(reading: { readingFont: ReadingFont; textSize: ReadingTextSize }): ExportOptions {
  return {
    format: "pdf",
    typeface: reading.readingFont === "newsreader" ? "newsreader" : "geist",
    textSize: reading.textSize,
    pageSize: getDefaultPageSize(),
    margins: "normal",
    pageNumbers: true,
    theme: "light",
  };
}

/** The last options used, over the defaults; anything unknown is ignored. */
export function loadExportOptions(defaults: ExportOptions): ExportOptions {
  let saved: Partial<Record<keyof ExportOptions, unknown>> = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") ?? {};
  } catch {
    // Missing or unreadable: the defaults stand.
  }

  const options = { ...defaults };
  for (const key of Object.keys(CHOICES) as (keyof ExportOptions)[]) {
    const value = saved[key];
    if ((CHOICES[key] as readonly unknown[]).includes(value)) {
      (options as Record<string, unknown>)[key] = value;
    }
  }
  return options;
}

export function saveExportOptions(options: ExportOptions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Only a convenience.
  }
}
