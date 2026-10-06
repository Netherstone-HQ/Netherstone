/**
 * Reads a Plate value into the export model (see `model.ts`). Everything that
 * decides what a shard *says* happens here, once, so HTML, PDF and Word
 * exports can't disagree: list nesting and numbering, which blocks a toggle
 * holds, link targets, date wording, code highlighting.
 */

import { getCodeLanguageLabel } from "@/components/editor/lib/code-languages";
import { normalizeMediaSourceValue } from "@/lib/media-source";

import { highlightCode } from "./highlight";
import type {
  Align,
  Block,
  ExportDocument,
  ExportImageRequest,
  Inline,
  ListItem,
  ListKind,
  OrderedStyle,
  TableCell,
  TextMarks,
  TocEntry,
} from "./model";

type PlateNode = Record<string, unknown> & {
  type?: string;
  text?: string;
  children?: PlateNode[];
};

const HEADING_LEVELS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

const ORDERED_STYLES = new Set<OrderedStyle>([
  "decimal",
  "lower-alpha",
  "upper-alpha",
  "lower-roman",
  "upper-roman",
]);

const INLINE_ELEMENT_TYPES = new Set(["a", "mention", "date", "inline_equation", "emoji", "mention_input"]);

const ZERO_WIDTH = /[​﻿]/g;

export interface BuildOptions {
  /** The shard's file name without extension; the title if it has no heading. */
  fileName: string;
  /** Formats dates. Defaults to the user's locale. */
  locale?: string;
}

class Builder {
  private readonly images = new Map<string, ExportImageRequest>();
  private readonly headingIds = new Set<string>();
  private readonly tocBlocks: Extract<Block, { type: "toc" }>[] = [];
  private readonly toc: TocEntry[] = [];
  hasMath = false;

  constructor(private readonly options: BuildOptions) {}

  get imageRequests() {
    return [...this.images.values()];
  }

  finishToc() {
    for (const block of this.tocBlocks) block.entries = this.toc;
  }

  // ── Inline content ────────────────────────────────────────────────────────

  inlines(nodes: PlateNode[] | undefined): Inline[] {
    const result: Inline[] = [];
    for (const node of nodes ?? []) this.inline(node, result);
    return mergeTexts(result);
  }

  private inline(node: PlateNode, out: Inline[]) {
    if (typeof node.text === "string") {
      const text = node.text.replace(ZERO_WIDTH, "");
      if (!text) return;
      const marks = readMarks(node);
      text.split("\n").forEach((part, index) => {
        if (index > 0) out.push({ type: "break" });
        if (part) out.push({ type: "text", text: part, marks });
      });
      return;
    }

    switch (node.type) {
      case "a": {
        const url = typeof node.url === "string" ? node.url.trim() : "";
        const children = this.inlines(node.children);
        if (!url || !isSafeLinkUrl(url)) {
          out.push(...children);
        } else {
          out.push({ type: "link", url, children: children.length ? children : [{ type: "text", text: url, marks: {} }] });
        }
        return;
      }
      case "mention": {
        const label = stringProp(node.value) || stringProp(node.key);
        if (label) out.push({ type: "mention", label });
        return;
      }
      case "date": {
        const text = formatDate(stringProp(node.date), this.options.locale);
        if (text) out.push({ type: "date", text });
        return;
      }
      case "inline_equation": {
        const tex = stringProp(node.texExpression).trim();
        if (tex) {
          this.hasMath = true;
          out.push({ type: "math", tex });
        }
        return;
      }
      default:
        // Emoji, unfinished mention inputs and anything newer: keep their text.
        for (const child of node.children ?? []) this.inline(child, out);
    }
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  blocks(nodes: PlateNode[] | undefined): Block[] {
    const items = (nodes ?? []).filter((node) => typeof node.text !== "string");
    // Containers like quotes may hold inline content directly.
    if (items.length === 0 || items.every((node) => INLINE_ELEMENT_TYPES.has(node.type ?? ""))) {
      const content = this.inlines(nodes);
      return content.length ? [{ type: "paragraph", content }] : [];
    }

    const flat = groupToggles(nodes ?? []);
    return trimSpacers(new ListAssembler(this).assemble(flat));
  }

  block(node: PlateNode): Block[] {
    const type = node.type ?? "p";
    const level = HEADING_LEVELS[type];

    if (level) {
      const content = this.inlines(node.children);
      if (!content.length) return [{ type: "spacer" }];
      const text = plainText(content);
      const id = this.uniqueHeadingId(text);
      this.toc.push({ level, id, text });
      return [{ type: "heading", level, id, content, align: readAlign(node.align) }];
    }

    switch (type) {
      case "p": {
        const content = this.inlines(node.children);
        if (!content.length) return [{ type: "spacer" }];
        const indent = numberProp(node.indent);
        return [{ type: "paragraph", content, align: readAlign(node.align), ...(indent ? { indent } : {}) }];
      }
      case "blockquote":
        return [{ type: "quote", children: this.blocks(node.children) }];
      case "callout":
        return [
          {
            type: "callout",
            icon: stringProp(node.icon) || "💡",
            children: this.blocks(node.children),
          },
        ];
      case "hr":
        return [{ type: "rule" }];
      case "code_block": {
        const language = stringProp(node.lang);
        const code = (node.children ?? [])
          .map((line) => nodeText(line).replace(ZERO_WIDTH, ""))
          .join("\n");
        return [
          {
            type: "code",
            languageLabel: getCodeLanguageLabel(language),
            lines: highlightCode(code, language),
          },
        ];
      }
      case "equation": {
        const tex = stringProp(node.texExpression).trim();
        if (!tex) return [];
        this.hasMath = true;
        return [{ type: "math", tex }];
      }
      case "img":
        return [this.image(node)];
      case "video":
      case "audio":
      case "file":
      case "media_embed":
        return this.media(node);
      case "table":
        return [this.table(node)];
      case "column_group":
        return [this.columns(node)];
      case "toc": {
        // Filled in once every heading is known.
        const block: Extract<Block, { type: "toc" }> = { type: "toc", entries: [] };
        this.tocBlocks.push(block);
        return [block];
      }
      case "toggle": {
        const toggle = node as PlateNode & { toggleChildren?: PlateNode[] };
        return [
          {
            type: "toggle",
            summary: this.inlines(toggle.children),
            children: this.blocks(toggle.toggleChildren),
          },
        ];
      }
      default: {
        // Unknown containers keep their content.
        if (node.children?.some((child) => typeof child.text !== "string" && !INLINE_ELEMENT_TYPES.has(child.type ?? ""))) {
          return this.blocks(node.children);
        }
        const content = this.inlines(node.children);
        return content.length ? [{ type: "paragraph", content }] : [];
      }
    }
  }

  private image(node: PlateNode): Block {
    const source = normalizeMediaSourceValue(stringProp(node.url));
    let assetId: string | null = null;
    if (source) {
      assetId = this.images.get(source)?.id ?? `img-${this.images.size}`;
      this.images.set(source, { id: assetId, source });
    }

    const caption = this.inlines(node.caption as PlateNode[] | undefined);
    const alt = stringProp(node.alt) || plainText(caption);
    const width = numberProp(node.width);

    return {
      type: "image",
      assetId,
      source,
      alt,
      caption,
      ...(width ? { width } : {}),
      align: readAlign(node.align) ?? "center",
    };
  }

  private media(node: PlateNode): Block[] {
    const url = normalizeMediaSourceValue(stringProp(node.url));
    if (!url) return [];
    const kind =
      node.type === "media_embed" ? "embed" : (node.type as "video" | "audio" | "file");
    const isRemote = /^https?:\/\//i.test(url);
    // A web address's last path segment ("watch") says little; its site does.
    const name =
      stringProp(node.name) ||
      (isRemote && kind !== "file" ? siteName(url) : "") ||
      fileNameFromSource(url);
    return [{ type: "media", kind, url, name, isRemote }];
  }

  private table(node: PlateNode): Block {
    const rows: TableCell[][] = (node.children ?? [])
      .filter((row) => row.type === "tr")
      .map((row) =>
        (row.children ?? []).map((cell) => ({
          header: cell.type === "th",
          colSpan: Math.max(1, numberProp(cell.colSpan) ?? numberProp((cell.attributes as PlateNode | undefined)?.colspan) ?? 1),
          rowSpan: Math.max(1, numberProp(cell.rowSpan) ?? numberProp((cell.attributes as PlateNode | undefined)?.rowspan) ?? 1),
          blocks: this.blocks(cell.children),
          ...(normalizeColor(cell.background) ? { background: normalizeColor(cell.background) } : {}),
        })),
      )
      .filter((row) => row.length > 0);

    const sizes = Array.isArray(node.colSizes) ? (node.colSizes as unknown[]).map(Number) : [];
    const columnWidths = sizes.length && sizes.every((size) => Number.isFinite(size) && size > 0) ? sizes : null;

    return { type: "table", rows, columnWidths };
  }

  private columns(node: PlateNode): Block {
    const columns = (node.children ?? []).filter((child) => child.type === "column");
    const parsed = columns.map((column) => parseFloat(stringProp(column.width)));
    const known = parsed.filter((width) => Number.isFinite(width) && width > 0);
    const widths =
      known.length === columns.length
        ? parsed.map((width) => width / known.reduce((sum, value) => sum + value, 0))
        : columns.map(() => 1 / Math.max(columns.length, 1));

    return {
      type: "columns",
      widths,
      columns: columns.map((column) => this.blocks(column.children)),
    };
  }

  private uniqueHeadingId(text: string) {
    const base =
      text
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "section";
    let id = base;
    for (let suffix = 2; this.headingIds.has(id); suffix += 1) id = `${base}-${suffix}`;
    this.headingIds.add(id);
    return id;
  }
}

// ── Lists ───────────────────────────────────────────────────────────────────

interface OpenList {
  depth: number;
  list: Extract<Block, { type: "list" }>;
  item: ListItem;
}

/**
 * Plate stores lists flat: each item is a block with `listStyleType` and an
 * `indent` depth, and a plain block indented to an item's depth continues
 * that item. This rebuilds the nesting.
 */
class ListAssembler {
  private readonly out: Block[] = [];
  private stack: OpenList[] = [];

  constructor(private readonly builder: Builder) {}

  assemble(nodes: PlateNode[]): Block[] {
    for (const node of nodes) {
      const kind = listKind(node);
      if (kind) this.addItem(node, kind);
      else this.addBlock(node);
    }
    return this.out;
  }

  private addItem(node: PlateNode, kind: ListKind) {
    const depth = Math.max(1, numberProp(node.indent) ?? 1);
    const style = listStyle(node, kind);

    while (this.top && this.top.depth > depth) this.stack.pop();

    const top = this.top;
    const restart = node.listRestart === true || typeof node.listRestartPolite === "number";
    let list: Extract<Block, { type: "list" }>;

    if (top && top.depth === depth && top.list.kind === kind && top.list.style === style && !restart) {
      list = top.list;
      this.stack.pop();
    } else {
      if (top && top.depth === depth) this.stack.pop();
      const start = numberProp(node.listStart) ?? numberProp(node.listRestartPolite) ?? 1;
      list = { type: "list", kind, style, start, items: [] };
      const parent = this.top;
      (parent ? parent.item.children : this.out).push(list);
    }

    const item: ListItem = {
      content: this.builder.inlines(node.children),
      number: list.start + list.items.length,
      children: [],
      ...(kind === "todo" ? { checked: node.checked === true } : {}),
    };
    list.items.push(item);
    this.stack.push({ depth, list, item });
  }

  private addBlock(node: PlateNode) {
    const indent = numberProp(node.indent) ?? 0;

    // A block indented to an open item's depth continues that item.
    while (this.top && this.top.depth > indent) this.stack.pop();
    const owner = this.top;

    const blocks = this.builder.block(node);
    if (owner && indent > 0) {
      for (const block of blocks) {
        if (block.type === "paragraph") delete block.indent;
        owner.item.children.push(block);
      }
      return;
    }

    this.stack = [];
    this.out.push(...blocks);
  }

  private get top(): OpenList | undefined {
    return this.stack[this.stack.length - 1];
  }
}

function listKind(node: PlateNode): ListKind | null {
  const style = stringProp(node.listStyleType);
  if (!style) return null;
  if (style === "todo") return "todo";
  if (ORDERED_STYLES.has(style as OrderedStyle)) return "ordered";
  return "bullet";
}

function listStyle(node: PlateNode, kind: ListKind): Extract<Block, { type: "list" }>["style"] {
  const style = stringProp(node.listStyleType);
  if (kind === "ordered") return style as OrderedStyle;
  if (style === "circle" || style === "square") return style;
  return "disc";
}

/**
 * A toggle owns the blocks after it that are indented deeper than it, the
 * way the editor hides them when it's closed.
 */
function groupToggles(nodes: PlateNode[]): PlateNode[] {
  const result: PlateNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node.type !== "toggle") {
      result.push(node);
      continue;
    }
    const depth = numberProp(node.indent) ?? 0;
    const children: PlateNode[] = [];
    while (index + 1 < nodes.length && (numberProp(nodes[index + 1].indent) ?? 0) > depth) {
      index += 1;
      const child = nodes[index];
      const childIndent = (numberProp(child.indent) ?? 0) - depth - 1;
      children.push({ ...child, indent: childIndent > 0 ? childIndent : undefined });
    }
    result.push({ ...node, toggleChildren: children });
  }
  return result;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readMarks(node: PlateNode): TextMarks {
  const marks: TextMarks = {};
  if (node.bold) marks.bold = true;
  if (node.italic) marks.italic = true;
  if (node.underline) marks.underline = true;
  if (node.strikethrough) marks.strikethrough = true;
  if (node.code) marks.code = true;
  if (node.subscript) marks.subscript = true;
  if (node.superscript) marks.superscript = true;
  if (node.kbd) marks.kbd = true;
  if (node.highlight) marks.highlight = true;
  const color = normalizeColor(node.color);
  if (color) marks.color = color;
  const background = normalizeColor(node.backgroundColor);
  if (background) marks.backgroundColor = background;
  return marks;
}

function sameMarks(a: TextMarks, b: TextMarks) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof TextMarks>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function mergeTexts(inlines: Inline[]): Inline[] {
  const merged: Inline[] = [];
  for (const inline of inlines) {
    const previous = merged[merged.length - 1];
    if (inline.type === "text" && previous?.type === "text" && sameMarks(previous.marks, inline.marks)) {
      merged[merged.length - 1] = { ...previous, text: previous.text + inline.text };
    } else {
      merged.push(inline);
    }
  }
  // A line break at either end is invisible in the editor.
  while (merged[0]?.type === "break") merged.shift();
  while (merged[merged.length - 1]?.type === "break") merged.pop();
  return merged;
}

function trimSpacers(blocks: Block[]): Block[] {
  let start = 0;
  let end = blocks.length;
  while (start < end && blocks[start].type === "spacer") start += 1;
  while (end > start && blocks[end - 1].type === "spacer") end -= 1;
  return blocks.slice(start, end);
}

function plainText(inlines: Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
          return inline.text;
        case "link":
          return plainText(inline.children);
        case "mention":
          return inline.label;
        case "date":
          return inline.text;
        case "math":
          return inline.tex;
        case "break":
          return " ";
      }
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeText(node: PlateNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.children ?? []).map(nodeText).join("");
}

function stringProp(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberProp(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}

function readAlign(value: unknown): Align | undefined {
  switch (value) {
    case "center":
    case "justify":
      return value;
    case "right":
    case "end":
      return "right";
    default:
      return undefined;
  }
}

/** Only links a reader can follow: web, mail and phone links and anchors. */
function isSafeLinkUrl(url: string) {
  return /^(https?:|mailto:|tel:|#)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** `#abc`, `#aabbcc` or `rgb(...)` to `#aabbcc`; anything else is dropped. */
export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const color = value.trim().toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(color);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(color)) return color;
  if (/^#[0-9a-f]{8}$/.test(color)) return color.slice(0, 7);

  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(color);
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    if (alpha === 0) return undefined;
    return `#${[rgb[1], rgb[2], rgb[3]]
      .map((channel) => Math.min(255, Number(channel)).toString(16).padStart(2, "0"))
      .join("")}`;
  }

  return undefined;
}

/**
 * Dates in words. Exports outlive the day they're made, so there is no
 * "Today" or "Tomorrow" here, unlike the editor.
 */
export function formatDate(value: string, locale?: string): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  // A plain date is a calendar day, not midnight UTC.
  const date = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

const KNOWN_SITES: Record<string, string> = {
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "vimeo.com": "Vimeo",
  "twitter.com": "X",
  "x.com": "X",
  "soundcloud.com": "SoundCloud",
  "spotify.com": "Spotify",
  "open.spotify.com": "Spotify",
  "loom.com": "Loom",
  "figma.com": "Figma",
  "github.com": "GitHub",
};

function siteName(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^(www|m)\./, "");
    return KNOWN_SITES[host] ?? host;
  } catch {
    return "";
  }
}

function fileNameFromSource(source: string) {
  const withoutQuery = source.split(/[?#]/)[0];
  const name = withoutQuery.split(/[\\/]/).filter(Boolean).pop() ?? source;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** The title a shard goes by: its first heading, or its file name. */
function documentTitle(blocks: Block[], fileName: string) {
  const headings = blocks.filter((block): block is Extract<Block, { type: "heading" }> => block.type === "heading");
  const first = headings.find((heading) => heading.level === 1) ?? headings[0];
  return (first && plainText(first.content)) || fileName;
}

export function buildExportDocument(value: unknown[], options: BuildOptions): ExportDocument {
  const builder = new Builder(options);
  const blocks = builder.blocks(value as PlateNode[]);
  builder.finishToc();

  return {
    title: documentTitle(blocks, options.fileName),
    blocks,
    images: builder.imageRequests,
    hasMath: builder.hasMath,
  };
}
