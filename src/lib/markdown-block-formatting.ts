import { KEYS, type TElement } from "platejs";
import {
  createRawBlockNode,
  RAW_BLOCK_KEY,
  type TRawBlockElement,
} from "@/lib/markdown-raw-blocks";

/**
 * Alignment, line height and indent have no Markdown of their own. They are
 * saved as a small HTML wrapper around the blocks that share them, with the
 * blocks still written as Markdown inside it:
 *
 *     <div align="center" style="line-height: 2; margin-left: 48px">
 *
 *     ## A centred heading
 *
 *     </div>
 *
 * GitHub and most renderers honour `align`; the rest show the content as
 * usual. On load such a wrapper puts the formatting back on the blocks it
 * holds and disappears; any `<div>` carrying anything else stays a raw block.
 */

export type BlockFormatting = {
  align?: string;
  lineHeight?: number;
  indent?: number;
};

/** One indent step, as `IndentKit` renders it. */
export const INDENT_OFFSET = 24;

/** `LineHeightKit`'s default; a block set back to it carries nothing. */
const DEFAULT_LINE_HEIGHT = 1.5;

const ALIGN_VALUES = new Set(["left", "center", "right", "justify"]);

// Which blocks carry which prop; must match the kits' `targetPlugins`.
const ALIGN_TYPES = new Set<string>([...KEYS.heading, KEYS.p, KEYS.img, KEYS.mediaEmbed]);
const LINE_HEIGHT_TYPES = new Set<string>([...KEYS.heading, KEYS.p]);
const INDENT_TYPES = new Set<string>([
  ...KEYS.heading,
  KEYS.p,
  KEYS.blockquote,
  KEYS.codeBlock,
  KEYS.toggle,
]);

function isElement(node: unknown): node is TElement {
  return (
    !!node &&
    typeof node === "object" &&
    typeof (node as TElement).type === "string" &&
    Array.isArray((node as TElement).children)
  );
}

/** The formatting a block carries that Markdown can't hold, if any. */
export function blockFormattingOf(node: unknown): BlockFormatting | null {
  if (!isElement(node)) return null;
  const record = node as Record<string, unknown>;
  // A list item's indent is its nesting, which the list syntax carries, and
  // a wrapper around one item would break the list.
  if (record.listStyleType) return null;
  const formatting: BlockFormatting = {};

  if (
    typeof record.align === "string" &&
    ALIGN_VALUES.has(record.align) &&
    ALIGN_TYPES.has(node.type)
  ) {
    formatting.align = record.align;
  }
  if (
    typeof record.lineHeight === "number" &&
    record.lineHeight > 0 &&
    record.lineHeight !== DEFAULT_LINE_HEIGHT &&
    LINE_HEIGHT_TYPES.has(node.type)
  ) {
    formatting.lineHeight = record.lineHeight;
  }
  if (typeof record.indent === "number" && record.indent > 0 && INDENT_TYPES.has(node.type)) {
    formatting.indent = Math.round(record.indent);
  }

  return Object.keys(formatting).length > 0 ? formatting : null;
}

function sameFormatting(a: BlockFormatting, b: BlockFormatting) {
  return (
    a.align === b.align && a.lineHeight === b.lineHeight && a.indent === b.indent
  );
}

function withoutFormatting(node: TElement, formatting: BlockFormatting): TElement {
  const {
    align: _align,
    lineHeight: _lineHeight,
    indent: _indent,
    ...rest
  } = node as TElement & BlockFormatting;
  return {
    ...rest,
    ...(formatting.align === undefined && _align !== undefined ? { align: _align } : {}),
    ...(formatting.lineHeight === undefined && _lineHeight !== undefined
      ? { lineHeight: _lineHeight }
      : {}),
    ...(formatting.indent === undefined && _indent !== undefined ? { indent: _indent } : {}),
  } as TElement;
}

/** `<div align="center" style="line-height: 2; margin-left: 48px">` */
export function formattingOpeningTag(formatting: BlockFormatting): string {
  const attributes: string[] = [];
  if (formatting.align) attributes.push(`align="${formatting.align}"`);

  const style: string[] = [];
  if (formatting.lineHeight !== undefined) {
    style.push(`line-height: ${formatting.lineHeight}`);
  }
  if (formatting.indent !== undefined) {
    style.push(`margin-left: ${formatting.indent * INDENT_OFFSET}px`);
  }
  if (style.length > 0) attributes.push(`style="${style.join("; ")}"`);

  return `<div ${attributes.join(" ")}>`;
}

const FORMATTING_CLOSING_TAG = "</div>";

const OPENING_DIV = /^<div((?:\s+[a-z-]+="[^"]*")*)\s*>$/i;
const ATTRIBUTE = /\s+([a-z-]+)="([^"]*)"/gi;
const LENGTH_PX = /^(\d+(?:\.\d+)?)px$/;

/**
 * The formatting a wrapper's opening tag carries, or null when the tag is
 * not one the editor can take apart (another attribute, another style
 * property, a value it has no setting for).
 */
export function parseFormattingOpeningTag(value: string): BlockFormatting | null {
  const match = OPENING_DIV.exec(value.trim());
  if (!match) return null;

  const formatting: BlockFormatting = {};
  for (const [, name, raw] of match[1].matchAll(ATTRIBUTE)) {
    const attribute = name.toLowerCase();
    if (attribute === "align") {
      const align = raw.trim().toLowerCase();
      if (!ALIGN_VALUES.has(align)) return null;
      formatting.align = align;
    } else if (attribute === "style") {
      for (const declaration of raw.split(";")) {
        if (!declaration.trim()) continue;
        const colon = declaration.indexOf(":");
        if (colon < 0) return null;
        const property = declaration.slice(0, colon).trim().toLowerCase();
        const setting = declaration.slice(colon + 1).trim().toLowerCase();
        if (property === "text-align") {
          if (!ALIGN_VALUES.has(setting)) return null;
          formatting.align = setting;
        } else if (property === "line-height") {
          const lineHeight = Number(setting);
          if (!Number.isFinite(lineHeight) || lineHeight <= 0) return null;
          formatting.lineHeight = lineHeight;
        } else if (property === "margin-left" || property === "padding-left") {
          const px = LENGTH_PX.exec(setting);
          if (!px) return null;
          formatting.indent = Math.max(1, Math.round(Number(px[1]) / INDENT_OFFSET));
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
  }

  return Object.keys(formatting).length > 0 ? formatting : null;
}

function isRawBlock(node: unknown): node is TRawBlockElement {
  return isElement(node) && node.type === RAW_BLOCK_KEY;
}

function opensDiv(node: unknown) {
  return isRawBlock(node) && /^<div[\s>]/i.test(node.value.trimStart());
}

function closesDiv(node: unknown) {
  return isRawBlock(node) && node.value.trim().toLowerCase() === FORMATTING_CLOSING_TAG;
}

function accepts(node: unknown, formatting: BlockFormatting) {
  if (!isElement(node) || node.type === RAW_BLOCK_KEY) return false;
  if ((node as Record<string, unknown>).listStyleType) return false;
  if (formatting.align !== undefined && !ALIGN_TYPES.has(node.type)) return false;
  if (formatting.lineHeight !== undefined && !LINE_HEIGHT_TYPES.has(node.type)) {
    return false;
  }
  if (formatting.indent !== undefined && !INDENT_TYPES.has(node.type)) return false;
  return true;
}

/** A block inside a toggle already carries the toggle's indent; the wrapper's adds to it. */
function withFormatting(node: TElement, formatting: BlockFormatting): TElement {
  const indent = typeof node.indent === "number" ? node.indent : 0;
  return {
    ...node,
    ...formatting,
    ...(formatting.indent !== undefined ? { indent: indent + formatting.indent } : {}),
  };
}

/** The index of the `</div>` closing the wrapper opened at `start`, if any. */
function closingIndex(value: unknown[], start: number) {
  let depth = 0;
  for (let index = start + 1; index < value.length; index += 1) {
    const node = value[index];
    if (opensDiv(node)) depth += 1;
    else if (closesDiv(node)) {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Puts the formatting of each wrapper back on the blocks it holds and drops
 * the wrapper, wherever blocks sit; a wrapper holding a block that can't
 * carry its formatting is kept as it was read.
 */
export function applyBlockFormatting<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const next: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];
    const formatting = isRawBlock(node) ? parseFormattingOpeningTag(node.value) : null;
    const end = formatting ? closingIndex(value, index) : -1;

    if (formatting && end > index + 1) {
      const inner = value.slice(index + 1, end);
      if (inner.every((block) => accepts(block, formatting))) {
        for (const block of inner) {
          const element = block as TElement;
          next.push({
            ...withFormatting(element, formatting),
            children: applyBlockFormatting(element.children),
          });
        }
        changed = true;
        index = end;
        continue;
      }
    }

    if (isElement(node)) {
      const children = applyBlockFormatting(node.children);
      if (children !== node.children) {
        changed = true;
        next.push({ ...node, children });
        continue;
      }
    }
    next.push(node);
  }

  return (changed ? next : value) as T;
}

const CELL_TYPES = new Set<string>([KEYS.td, KEYS.th]);

/** The blocks inside a node: its children, and a gathered toggle's body. */
function wrapInside(node: unknown): unknown {
  if (!isElement(node) || CELL_TYPES.has(node.type)) return node;
  const children = wrapFormattedBlocks(node.children);
  const body = (node as { body?: unknown }).body;
  const wrappedBody = wrapFormattedBlocks(body);
  if (children === node.children && wrappedBody === body) return node;
  return { ...node, children, ...(wrappedBody !== body ? { body: wrappedBody } : {}) };
}

/**
 * Wraps each run of neighbouring blocks that share formatting in one
 * wrapper, with the formatting taken off the blocks themselves, wherever
 * blocks sit. A table cell's alignment is its column's and stays put.
 */
export function wrapFormattedBlocks<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const next: unknown[] = [];
  let open: BlockFormatting | null = null;

  const close = () => {
    if (open) next.push(createRawBlockNode(FORMATTING_CLOSING_TAG));
    open = null;
  };

  for (const raw of value) {
    const node = wrapInside(raw);
    if (node !== raw) changed = true;
    const formatting = blockFormattingOf(node);
    if (!formatting) {
      close();
      next.push(node);
      continue;
    }

    changed = true;
    if (!open || !sameFormatting(open, formatting)) {
      close();
      next.push(createRawBlockNode(formattingOpeningTag(formatting)));
      open = formatting;
    }
    next.push(withoutFormatting(node as TElement, formatting));
  }
  close();

  return (changed ? next : value) as T;
}
