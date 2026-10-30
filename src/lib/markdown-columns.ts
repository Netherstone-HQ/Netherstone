import { KEYS, type TElement } from "platejs";

import { createRawBlockNode, type TRawBlockElement } from "@/lib/markdown-raw-blocks";

/**
 * Markdown has no columns, so a column group is saved as its blocks one
 * after another, between hidden comments that carry the layout:
 *
 *     <!-- netherstone columns: 50%, 50% -->
 *
 *     Left column as normal Markdown.
 *
 *     <!-- netherstone column -->
 *
 *     Right column.
 *
 *     <!-- netherstone /columns -->
 *
 * Other Markdown apps hide the comments and show the columns stacked.
 * Groups saved as `<column_group>` tags before this still load.
 */

const START = /^<!--\s*netherstone columns(?::\s*([^>]*?))?\s*-->$/;
const SEPARATOR = /^<!--\s*netherstone column\s*-->$/;
const END = /^<!--\s*netherstone \/columns\s*-->$/;

function commentOf(node: unknown): string | null {
  const record = node as TRawBlockElement | null;
  return record && typeof record === "object" && record.type === "raw_block"
    ? String(record.value ?? "").trim()
    : null;
}

/**
 * The blocks a column group saves as. `walk` prepares each column's blocks
 * for saving the same way as the rest of the shard.
 */
export function columnGroupBlocks(
  group: TElement,
  walk: (children: unknown[]) => unknown[],
): unknown[] {
  const columns = group.children as TElement[];
  const widths = columns.map((column) => column.width);
  const layout = widths.every((width) => typeof width === "string" && width)
    ? `: ${widths.join(", ")}`
    : "";

  const blocks: unknown[] = [createRawBlockNode(`<!-- netherstone columns${layout} -->`)];
  columns.forEach((column, index) => {
    if (index > 0) blocks.push(createRawBlockNode("<!-- netherstone column -->"));
    blocks.push(...walk(column.children));
  });
  blocks.push(createRawBlockNode("<!-- netherstone /columns -->"));
  return blocks;
}

function column(children: unknown[], width: string | undefined): TElement {
  return {
    type: KEYS.column,
    ...(width ? { width } : {}),
    children: children.length
      ? (children as TElement[])
      : [{ type: KEYS.p, children: [{ text: "" }] }],
  };
}

/**
 * Gathers the blocks between column comments back into a column group. A
 * start comment with no end after it stays as it is.
 */
export function applyColumns<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const next: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];
    const start = START.exec(commentOf(node) ?? "");
    const end = start
      ? value.findIndex((other, at) => at > index && END.test(commentOf(other) ?? ""))
      : -1;

    if (start && end > index) {
      const widths = start[1]?.split(",").map((width) => width.trim()) ?? [];
      const parts: unknown[][] = [[]];
      for (const block of value.slice(index + 1, end)) {
        if (SEPARATOR.test(commentOf(block) ?? "")) parts.push([]);
        else parts[parts.length - 1].push(block);
      }
      const sized = widths.length === parts.length;
      next.push({
        type: KEYS.columnGroup,
        children: parts.map((part, at) => column(part, sized ? widths[at] : undefined)),
      });
      index = end;
      changed = true;
      continue;
    }

    if (node && typeof node === "object" && Array.isArray((node as TElement).children)) {
      const children = applyColumns((node as TElement).children);
      if (children !== (node as TElement).children) {
        changed = true;
        next.push({ ...(node as TElement), children });
        continue;
      }
    }

    next.push(node);
  }

  return (changed ? next : value) as T;
}
