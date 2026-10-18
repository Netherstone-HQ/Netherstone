import { createSlatePlugin, type TElement } from "platejs";

/**
 * HTML the editor has no block for (comments, `<div>`s, tables written as
 * HTML, anything another tool put in the file) is kept exactly as written:
 * shown as a read-only block and saved back verbatim. Before this, Plate
 * escaped it into literal text (`\<div>…`) or mangled comments into
 * `\{/* … *\/}`.
 */

export const RAW_BLOCK_KEY = "raw_block";

export type TRawBlockElement = TElement & {
  type: typeof RAW_BLOCK_KEY;
  /** The HTML block exactly as it was in the file, without its final newline. */
  value: string;
};

/** Block-level tags Plate's Markdown rules handle; these never become raw blocks. */
const PLATE_BLOCK_TAGS = new Set([
  "audio",
  "br",
  "callout",
  "column",
  "column_group",
  "details",
  "file",
  "img",
  "media_embed",
  "toc",
  "video",
]);

/** Inline tags Plate reads as marks; a line holding only one stays inline. */
const PLATE_INLINE_TAGS = new Set([
  "a",
  "b",
  "code",
  "date",
  "del",
  "em",
  "i",
  "kbd",
  "mark",
  "s",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

// The first tag of the block, opening or closing (`</callout>` on its own
// line is a block of its own to CommonMark).
const TAG_NAME = /^<\/?([A-Za-z][\w-]*)/;

/** Whether a block-level HTML range should be kept verbatim. */
export function isRawHtmlBlock(source: string): boolean {
  const trimmed = source.trimStart();
  if (trimmed.startsWith("<!--")) return true;
  const tag = TAG_NAME.exec(trimmed)?.[1].toLowerCase();
  if (!tag) return true;
  return !PLATE_BLOCK_TAGS.has(tag) && !PLATE_INLINE_TAGS.has(tag);
}

// A private-use character that doesn't occur in prose, so a placeholder
// paragraph can be told apart from the user's text after parsing.
const MARK = "";

export function rawBlockPlaceholder(index: number): string {
  return `${MARK}${index}${MARK}`;
}

const PLACEHOLDER = new RegExp(`^${MARK}(\\d+)${MARK}$`);

export function createRawBlockNode(value: string): TRawBlockElement {
  return { type: RAW_BLOCK_KEY, value, children: [{ text: "" }] };
}

/** Swaps placeholder paragraphs back for the raw HTML they stand for. */
export function restoreRawBlocks<T>(value: T, blocks: string[]): T {
  if (blocks.length === 0 || !Array.isArray(value)) return value;

  let changed = false;
  const next = value.map((node) => {
    if (!node || typeof node !== "object") return node;
    const record = node as TElement;
    const text =
      record.type === "p" &&
      record.children?.length === 1 &&
      typeof (record.children[0] as { text?: unknown }).text === "string"
        ? ((record.children[0] as { text: string }).text)
        : null;
    const match = text === null ? null : PLACEHOLDER.exec(text);
    if (match && blocks[Number(match[1])] !== undefined) {
      changed = true;
      return createRawBlockNode(blocks[Number(match[1])]);
    }
    const children = restoreRawBlocks(record.children, blocks);
    if (children !== record.children) {
      changed = true;
      return { ...record, children };
    }
    return node;
  });

  return (changed ? next : value) as T;
}

/** The node definition; the editor kit adds the component. */
export const BaseRawBlockPlugin = createSlatePlugin({
  key: RAW_BLOCK_KEY,
  node: { isElement: true, isVoid: true },
});

/** Saves the block exactly as it was read. */
export const rawBlockRules = {
  [RAW_BLOCK_KEY]: {
    serialize: (node: TElement) => ({
      type: "html",
      value: String((node as TRawBlockElement).value ?? ""),
    }),
  },
};
