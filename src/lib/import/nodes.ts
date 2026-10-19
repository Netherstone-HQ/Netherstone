import type { PlateNode } from "./types";

/**
 * Small builders for the Plate value importers return. They produce exactly
 * the shapes the editor saves (see `src/lib/export/build.ts` for the same
 * shapes read back), so a converted file saves like one written by hand.
 */

export type Marks = {
  bold?: true;
  italic?: true;
  underline?: true;
  strikethrough?: true;
  code?: true;
  subscript?: true;
  superscript?: true;
  highlight?: true;
  /** `#rrggbb` */
  color?: string;
  backgroundColor?: string;
  /** `18px` */
  fontSize?: string;
};

export type Align = "left" | "center" | "right" | "justify";

export interface BlockProps {
  align?: Align;
  /** Indent steps of the editor's indent button. */
  indent?: number;
  lineHeight?: number;
}

export function text(value: string, marks: Marks = {}): PlateNode {
  return { text: value, ...marks };
}

/** Drops empty runs and joins neighbours with the same marks. */
export function tidyInlines(inlines: PlateNode[]): PlateNode[] {
  const out: PlateNode[] = [];
  for (const node of inlines) {
    if (typeof node.text === "string") {
      if (node.text === "") continue;
      const previous = out[out.length - 1];
      if (previous && typeof previous.text === "string" && sameMarks(previous, node)) {
        out[out.length - 1] = { ...previous, text: previous.text + node.text };
        continue;
      }
    }
    out.push(node);
  }
  return out.length ? out : [{ text: "" }];
}

function sameMarks(a: PlateNode, b: PlateNode) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  keys.delete("text");
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function blockProps(props: BlockProps): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (props.align && props.align !== "left") out.align = props.align;
  if (props.indent && props.indent > 0) out.indent = Math.min(props.indent, 8);
  if (props.lineHeight) out.lineHeight = props.lineHeight;
  return out;
}

export function paragraph(children: PlateNode[], props: BlockProps = {}): PlateNode {
  return { type: "p", ...blockProps(props), children: tidyInlines(children) };
}

export function heading(level: number, children: PlateNode[], props: BlockProps = {}): PlateNode {
  const clamped = Math.min(Math.max(Math.round(level), 1), 6);
  return { type: `h${clamped}`, ...blockProps({ align: props.align }), children: tidyInlines(children) };
}

export type ListType =
  | "disc"
  | "circle"
  | "square"
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman"
  | "todo";

/**
 * Plate keeps lists flat: each item is a paragraph with a list style and a
 * depth (`indent`, from 1). `start` is only needed on the first item of a
 * numbered list that doesn't start at 1.
 */
export function listItem(
  children: PlateNode[],
  options: { type: ListType; depth: number; start?: number; checked?: boolean; align?: Align },
): PlateNode {
  const node: PlateNode = {
    type: "p",
    listStyleType: options.type,
    indent: Math.min(Math.max(options.depth, 1), 8),
    children: tidyInlines(children),
  };
  if (options.align && options.align !== "left") node.align = options.align;
  if (options.start !== undefined && options.start !== 1) node.listStart = options.start;
  if (options.type === "todo") node.checked = options.checked === true;
  return node;
}

export function blockquote(children: PlateNode[]): PlateNode {
  return { type: "blockquote", children: tidyInlines(children) };
}

/** A callout holds blocks. */
export function callout(icon: string, children: PlateNode[]): PlateNode {
  return { type: "callout", icon, children: children.length ? children : [paragraph([])] };
}

export function codeBlock(lines: string[], lang?: string): PlateNode {
  return {
    type: "code_block",
    ...(lang ? { lang } : {}),
    children: (lines.length ? lines : [""]).map((line) => ({
      type: "code_line",
      children: [{ text: line }],
    })),
  };
}

export function rule(): PlateNode {
  return { type: "hr", children: [{ text: "" }] };
}

export function image(url: string, options: { width?: number; alt?: string; align?: Align } = {}): PlateNode {
  const node: PlateNode = { type: "img", url, children: [{ text: "" }] };
  if (options.width && options.width > 0) node.width = Math.round(options.width);
  if (options.alt) node.alt = options.alt;
  if (options.align && options.align !== "center") node.align = options.align;
  return node;
}

export function fileBlock(url: string, name: string): PlateNode {
  return { type: "file", url, name, children: [{ text: "" }] };
}

export function link(url: string, children: PlateNode[]): PlateNode {
  return { type: "a", url, children: tidyInlines(children) };
}

export function equation(tex: string): PlateNode {
  return { type: "equation", texExpression: tex, children: [{ text: "" }] };
}

export function inlineEquation(tex: string): PlateNode {
  return { type: "inline_equation", texExpression: tex, children: [{ text: "" }] };
}

export function toc(): PlateNode {
  return { type: "toc", children: [{ text: "" }] };
}

export interface CellInput {
  children: PlateNode[];
  header?: boolean;
  colSpan?: number;
  rowSpan?: number;
  background?: string;
}

/**
 * A table. Cells hold blocks; `columnWidths` are pixels. Rows that came out
 * short (a merged cell the source left out) are padded so the table stays
 * rectangular.
 */
export function table(rows: CellInput[][], columnWidths?: number[]): PlateNode {
  const node: PlateNode = {
    type: "table",
    children: rows.map((row) => ({
      type: "tr",
      children: row.map((cell) => {
        const out: PlateNode = {
          type: cell.header ? "th" : "td",
          children: cell.children.length ? cell.children : [paragraph([])],
        };
        if (cell.colSpan && cell.colSpan > 1) out.colSpan = cell.colSpan;
        if (cell.rowSpan && cell.rowSpan > 1) out.rowSpan = cell.rowSpan;
        if (cell.background) out.background = cell.background;
        return out;
      }),
    })),
  };
  if (columnWidths?.length && columnWidths.every((width) => width > 0)) {
    node.colSizes = columnWidths.map((width) => Math.round(width));
  }
  return node;
}

/** The plain text of some nodes. */
export function plainText(nodes: PlateNode[] | undefined): string {
  return (nodes ?? [])
    .map((node) => (typeof node.text === "string" ? node.text : plainText(node.children)))
    .join("");
}

/** True for a paragraph with nothing but whitespace in it. */
export function isEmptyParagraph(node: PlateNode) {
  return node.type === "p" && !node.listStyleType && plainText(node.children).trim() === "" &&
    !(node.children ?? []).some((child) => typeof child.text !== "string");
}

/**
 * Plain text as paragraphs: blank lines separate paragraphs and single line
 * breaks stay line breaks.
 */
export function textToParagraphs(value: string): PlateNode[] {
  return value
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((block) => block.replace(/^\n+|\s+$/g, ""))
    .filter((block) => block.trim() !== "")
    .map((block) => paragraph([text(block)]));
}

/** `#abc`, `#aabbcc`, `rgb(…)` or a few names, as `#rrggbb`; null otherwise. */
/**
 * Black and near-black text is the document's ordinary text colour, not a
 * colour someone picked; carrying it over would fight the app's themes.
 */
export function isTextColor(color: string) {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return !!hex && Math.max(...hex.slice(1).map((part) => parseInt(part, 16))) < 0x30;
}

export function normalizeColor(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  const hex = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/.exec(trimmed);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, (c) => c + c) : hex[1];
    return `#${digits}`;
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(trimmed);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    if (alpha === 0) return null;
    return `#${[rgb[1], rgb[2], rgb[3]].map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0")).join("")}`;
  }
  return NAMED_COLORS[trimmed] ?? null;
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  yellow: "#ffff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  gray: "#808080",
  grey: "#808080",
  orange: "#ffa500",
  purple: "#800080",
};
