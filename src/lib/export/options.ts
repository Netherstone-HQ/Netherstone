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

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: "PDF",
  docx: "Word",
  html: "Web page",
};

type Choices<T extends string> = readonly { value: T; label: string }[];

/** The choices the export window offers, with their labels, in order. */
export const EXPORT_CHOICES: {
  format: Choices<ExportFormat>;
  typeface: Choices<Typeface>;
  textSize: Choices<TextSize>;
  pageSize: Choices<PageSize>;
  margins: Choices<Margins>;
  theme: Choices<HtmlTheme>;
} = {
  format: (["pdf", "docx", "html"] as const).map((value) => ({ value, label: FORMAT_LABELS[value] })),
  typeface: [
    { value: "newsreader", label: "Newsreader" },
    { value: "geist", label: "Geist" },
  ],
  textSize: [
    { value: "small", label: "Small" },
    { value: "default", label: "Default" },
    { value: "large", label: "Large" },
  ],
  pageSize: [
    { value: "a4", label: "A4" },
    { value: "letter", label: "US Letter" },
  ],
  margins: [
    { value: "narrow", label: "Narrow" },
    { value: "normal", label: "Normal" },
    { value: "wide", label: "Wide" },
  ],
  theme: [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ],
};

const CHOICES: { [K in keyof ExportOptions]: readonly ExportOptions[K][] } = {
  format: EXPORT_CHOICES.format.map(({ value }) => value),
  typeface: EXPORT_CHOICES.typeface.map(({ value }) => value),
  textSize: EXPORT_CHOICES.textSize.map(({ value }) => value),
  pageSize: EXPORT_CHOICES.pageSize.map(({ value }) => value),
  margins: EXPORT_CHOICES.margins.map(({ value }) => value),
  pageNumbers: [true, false],
  theme: EXPORT_CHOICES.theme.map(({ value }) => value),
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
