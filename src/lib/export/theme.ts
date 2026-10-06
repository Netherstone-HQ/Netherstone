/**
 * Design tokens shared by every export format. The values come from the
 * editor's light theme (App.css and the node components), adjusted for
 * white paper, so an exported shard reads like the shard in the app.
 */

export const PALETTE = {
  paper: "#ffffff",
  ink: "#141516",
  muted: "#6b6862",
  rule: "#e3dfd8",
  /** Callouts, mentions, dates and inline code. */
  surface: "#f1eee9",
  /** Code blocks: the editor's `bg-muted/50` over white. */
  codeSurface: "#f7f5f2",
  kbdBorder: "#d6d1c8",
  /** Links are ink with an underline, as in the editor. */
  link: "#141516",
  /** Horizontal rules: the editor's 2px `bg-muted` bar. */
  ruleBar: "#e6e2db",
  /** The editor's highlighter at 30% over white. */
  highlight: "#feeeb3",
  tableHeader: "#f7f5f2",
} as const;

/** The app's dark theme, for HTML exports viewed in dark mode. */
export const DARK_PALETTE = {
  paper: "#141516",
  ink: "#eeebe5",
  muted: "#a8a49c",
  rule: "#2f3133",
  surface: "#222325",
  codeSurface: "#1c1d1f",
  kbdBorder: "#3a3c3f",
  link: "#eeebe5",
  ruleBar: "#2a2c2e",
  highlight: "#5a4b0f",
  tableHeader: "#1c1d1f",
} as const;

export type Typeface = "newsreader" | "geist";
export type TextSize = "small" | "default" | "large";
export type PageSize = "a4" | "letter";
export type Margins = "narrow" | "normal" | "wide";

const EMOJI = `"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;

export const FONT_STACKS = {
  newsreader: `"Newsreader", "Iowan Old Style", Georgia, serif, ${EMOJI}`,
  geist: `"Geist", ui-sans-serif, "Segoe UI", Helvetica, Arial, sans-serif, ${EMOJI}`,
  mono: `"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`,
} as const;

/** Word names fonts directly: the family, and what to use where it's missing. */
export const WORD_FONTS = {
  newsreader: { name: "Newsreader", fallback: "Georgia", kind: "roman" },
  geist: { name: "Geist", fallback: "Arial", kind: "swiss" },
  mono: { name: "Geist Mono", fallback: "Consolas", kind: "modern" },
} as const;

/** Body text size: pixels on screen, points on paper. */
const BODY_SIZES: Record<TextSize, { px: number; pt: number }> = {
  small: { px: 15, pt: 10 },
  default: { px: 17, pt: 11 },
  large: { px: 19, pt: 12 },
};

export function bodySize(textSize: TextSize) {
  return BODY_SIZES[textSize];
}

/**
 * Sizes for Word, in points, scaled from the body size. The same ratios as
 * the HTML styles (and the editor): h1 is about 2.2× the body.
 */
export function printType(textSize: TextSize) {
  const body = BODY_SIZES[textSize].pt;
  const at = (ratio: number) => Math.round(body * ratio * 2) / 2;
  return {
    body,
    lineHeight: 1.5,
    paragraphGap: at(0.55),
    small: at(0.82),
    code: at(0.82),
    codeLineHeight: 1.45,
    footer: at(0.78),
    headings: {
      1: { size: at(2.2), before: at(2), after: at(0.7) },
      2: { size: at(1.5), before: at(1.6), after: at(0.55) },
      3: { size: at(1.24), before: at(1.25), after: at(0.4) },
      4: { size: at(1.1), before: at(1.1), after: at(0.3) },
      5: { size: at(1.05), before: at(0.9), after: at(0.3) },
      6: { size: at(1), before: at(0.9), after: at(0.3) },
    },
  };
}

export type PrintType = ReturnType<typeof printType>;

const PAGE_SIZES: Record<PageSize, { widthMm: number; heightMm: number }> = {
  a4: { widthMm: 210, heightMm: 297 },
  letter: { widthMm: 215.9, heightMm: 279.4 },
};

const MARGINS_MM: Record<Margins, { top: number; side: number; bottom: number }> = {
  narrow: { top: 14, side: 14, bottom: 16 },
  normal: { top: 22, side: 24, bottom: 24 },
  wide: { top: 30, side: 34, bottom: 32 },
};

export interface PageGeometry {
  widthMm: number;
  heightMm: number;
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
}

export function pageGeometry(pageSize: PageSize, margins: Margins): PageGeometry {
  const page = PAGE_SIZES[pageSize];
  const margin = MARGINS_MM[margins];
  return {
    widthMm: page.widthMm,
    heightMm: page.heightMm,
    marginTopMm: margin.top,
    marginRightMm: margin.side,
    marginBottomMm: margin.bottom,
    marginLeftMm: margin.side,
  };
}

/** Countries that use US Letter paper. */
const LETTER_REGIONS = new Set(["US", "CA", "MX", "PH", "CL", "CO", "VE", "GT", "PR", "CR", "PA", "DO", "SV", "NI", "HN", "BO"]);

/** Letter where it is the norm, A4 everywhere else. */
export function getDefaultPageSize(locale = navigator.language): PageSize {
  try {
    const region = new Intl.Locale(locale).maximize().region;
    return region && LETTER_REGIONS.has(region) ? "letter" : "a4";
  } catch {
    return "a4";
  }
}

/**
 * Syntax colors of the editor's code blocks (GitHub light), by highlight.js
 * scope. The first matching scope of a token wins.
 */
export const CODE_TOKEN_STYLES: Record<
  string,
  { color?: string; bold?: boolean; italic?: boolean }
> = {
  keyword: { color: "#d73a49" },
  doctag: { color: "#d73a49" },
  "template-tag": { color: "#d73a49" },
  "template-variable": { color: "#d73a49" },
  type: { color: "#d73a49" },
  "variable.language_": { color: "#d73a49" },
  title: { color: "#6f42c1" },
  "title.class_": { color: "#6f42c1" },
  "title.function_": { color: "#6f42c1" },
  attr: { color: "#005cc5" },
  attribute: { color: "#005cc5" },
  literal: { color: "#005cc5" },
  meta: { color: "#005cc5" },
  number: { color: "#005cc5" },
  operator: { color: "#005cc5" },
  "selector-attr": { color: "#005cc5" },
  "selector-class": { color: "#005cc5" },
  "selector-id": { color: "#005cc5" },
  variable: { color: "#005cc5" },
  regexp: { color: "#032f62" },
  string: { color: "#032f62" },
  built_in: { color: "#e36209" },
  symbol: { color: "#e36209" },
  comment: { color: "#6a737d" },
  code: { color: "#6a737d" },
  formula: { color: "#6a737d" },
  name: { color: "#22863a" },
  quote: { color: "#22863a" },
  "selector-tag": { color: "#22863a" },
  "selector-pseudo": { color: "#22863a" },
  subst: { color: "#141516" },
  section: { color: "#005cc5", bold: true },
  bullet: { color: "#735c0f" },
  emphasis: { italic: true },
  strong: { bold: true },
  addition: { color: "#22863a" },
  deletion: { color: "#b31d28" },
};
