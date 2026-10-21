import { defaultRules, type MdRules } from "@platejs/markdown";
import type { TElement } from "platejs";

import { createRawBlockNode, RAW_BLOCK_KEY } from "@/lib/markdown-raw-blocks";

/**
 * Tables are saved as plain pipe tables. What a pipe table can't hold is
 * written in one hidden HTML comment on the line above it, which every
 * Markdown renderer ignores:
 *
 *     <!-- netherstone: widths 120 240; merge A1:B1 C2:C3; fill A1=#fee; noborder B2 top left -->
 *
 * - `widths`: the column widths in pixels, once a column edge was dragged,
 *   or as shares of the text column when written by hand (`widths 30% 30%`
 *   takes 60% of it). A table without them is as wide as its content, up to
 *   the text column.
 * - `merge`: each merged cell as the range it covers, spreadsheet style.
 *   The pipe table keeps an empty cell for every covered position, so it
 *   stays rectangular for other apps.
 * - `fill`: cell background colours.
 * - `noborder`: cell sides drawn without a border.
 *
 * Column alignment needs no comment: it is the pipe table's own `:---:`.
 */

const TABLE_META = /^<!--\s*netherstone:\s*([\s\S]*?)\s*-->$/;

type Cell = TElement & {
  colSpan?: number;
  rowSpan?: number;
  background?: string;
  borders?: Partial<Record<Side, { size?: number }>>;
};

type Table = TElement & {
  colSizes?: number[];
  /** Hand-written percentage widths, kept until a column edge is dragged. */
  colPercents?: number[];
  children: TElement[];
};

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];

function isTable(node: unknown): node is Table {
  return !!node && typeof node === "object" && (node as TElement).type === "table";
}

function isRawBlock(node: unknown): node is TElement & { value: string } {
  return (
    !!node &&
    typeof node === "object" &&
    (node as TElement).type === RAW_BLOCK_KEY &&
    typeof (node as { value?: unknown }).value === "string"
  );
}

// ── Cell references ───────────────────────────────────────────────────────────

/** `A1` for the first cell, `AA3` past 26 columns. */
export function cellRef(row: number, col: number) {
  let letters = "";
  let n = col + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

export function parseCellRef(ref: string): { row: number; col: number } | null {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!match) return null;
  let col = 0;
  for (const letter of match[1].toUpperCase()) {
    col = col * 26 + (letter.charCodeAt(0) - 64);
  }
  return { row: Number(match[2]) - 1, col: col - 1 };
}

// ── The grid ──────────────────────────────────────────────────────────────────

type Placed = { cell: Cell; row: number; col: number; rowSpan: number; colSpan: number };

/** Where each cell of an editor table sits in the full grid, spans included. */
function placeCells(table: Table): { placed: Placed[]; rows: number; cols: number } {
  const taken = new Set<string>();
  const placed: Placed[] = [];
  let cols = 0;

  table.children.forEach((row, rowIndex) => {
    let col = 0;
    for (const child of row.children as Cell[]) {
      while (taken.has(`${rowIndex}:${col}`)) col += 1;
      const colSpan = Math.max(1, Number(child.colSpan) || 1);
      const rowSpan = Math.max(1, Number(child.rowSpan) || 1);
      for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
        for (let c = col; c < col + colSpan; c += 1) taken.add(`${r}:${c}`);
      }
      placed.push({ cell: child, row: rowIndex, col, rowSpan, colSpan });
      col += colSpan;
      cols = Math.max(cols, col);
    }
  });

  return { placed, rows: table.children.length, cols };
}

function emptyCell(type: string): Cell {
  return { type, children: [{ type: "p", children: [{ text: "" }] }] };
}

function compactColor(color: string) {
  return color.replace(/\s+/g, "");
}

// ── Saving ────────────────────────────────────────────────────────────────────

/**
 * The table as the pipe table holds it (rectangular, no spans) and the
 * comment that carries the rest, or null when the table needs none.
 */
export function prepareTableForMarkdown(table: Table): {
  table: Table;
  meta: string | null;
} {
  const { placed, rows, cols } = placeCells(table);
  const parts: string[] = [];

  const widths = (table.colSizes ?? []).filter((w) => Number.isFinite(w) && w > 0);
  const percents = (table.colPercents ?? []).filter((w) => Number.isFinite(w) && w > 0);
  if (widths.length > 0 && widths.length === cols) {
    parts.push(`widths ${widths.map((w) => Math.round(w)).join(" ")}`);
  } else if (percents.length > 0 && percents.length === cols) {
    parts.push(`widths ${percents.map((w) => `${roundPercent(w)}%`).join(" ")}`);
  }

  const merges = placed
    .filter((p) => p.colSpan > 1 || p.rowSpan > 1)
    .map(
      (p) =>
        `${cellRef(p.row, p.col)}:${cellRef(p.row + p.rowSpan - 1, p.col + p.colSpan - 1)}`,
    );
  if (merges.length > 0) parts.push(`merge ${merges.join(" ")}`);

  const fills = placed
    .filter((p) => typeof p.cell.background === "string" && p.cell.background.trim())
    .map((p) => `${cellRef(p.row, p.col)}=${compactColor(p.cell.background!)}`);
  if (fills.length > 0) parts.push(`fill ${fills.join(" ")}`);

  const hidden = placed.flatMap((p) => {
    const sides = SIDES.filter((side) => p.cell.borders?.[side]?.size === 0);
    return sides.length > 0 ? [`${cellRef(p.row, p.col)} ${sides.join(" ")}`] : [];
  });
  if (hidden.length > 0) parts.push(`noborder ${hidden.join(", ")}`);

  const needsGrid = placed.some((p) => p.colSpan > 1 || p.rowSpan > 1);
  const starts = new Map(placed.map((p) => [`${p.row}:${p.col}`, p]));
  const children = !needsGrid
    ? table.children
    : Array.from({ length: rows }, (_, r) => {
        const row = table.children[r];
        const cellType = r === 0 ? "th" : "td";
        const cells: Cell[] = [];
        for (let c = 0; c < cols; c += 1) {
          const start = starts.get(`${r}:${c}`);
          if (start) {
            const { colSpan: _cs, rowSpan: _rs, ...rest } = start.cell;
            cells.push(rest as Cell);
          } else {
            cells.push(emptyCell(cellType));
          }
        }
        return { ...row, children: cells };
      });

  const { colSizes: _sizes, colPercents: _percents, ...rest } = table;
  return {
    table: { ...rest, children } as Table,
    meta: parts.length > 0 ? `<!-- netherstone: ${parts.join("; ")} -->` : null,
  };
}

/** At most two decimals, without trailing zeros (`33.33`, `25`). */
function roundPercent(value: number): string {
  return String(Math.round(value * 100) / 100);
}

// ── Loading ───────────────────────────────────────────────────────────────────

function parseMeta(comment: string) {
  const body = TABLE_META.exec(comment.trim())?.[1];
  if (body === undefined) return null;

  const meta = {
    widths: [] as number[],
    percents: [] as number[],
    merges: [] as { row: number; col: number; rowSpan: number; colSpan: number }[],
    fills: [] as { row: number; col: number; color: string }[],
    hidden: [] as { row: number; col: number; sides: Side[] }[],
  };

  for (const part of body.split(";")) {
    const [keyword, ...tokens] = part.trim().split(/\s+/).filter(Boolean);
    if (!keyword) continue;
    switch (keyword.toLowerCase()) {
      case "widths": {
        // All pixels (`120`, `120px`) or all percentages (`25%`). Anything
        // else is ignored, and the table sizes by content.
        const unit = tokens.every((t) => t.endsWith("%")) ? "%" : "px";
        const values = tokens.map((t) => Number(t.replace(unit === "%" ? /%$/ : /px$/i, "")));
        if (!values.every((w) => Number.isFinite(w) && w > 0)) break;
        if (unit === "%") meta.percents = values;
        else meta.widths = values;
        break;
      }
      case "merge":
        for (const token of tokens) {
          const [from, to] = token.split(":").map((ref) => parseCellRef(ref));
          if (!from || !to || to.row < from.row || to.col < from.col) continue;
          meta.merges.push({
            row: from.row,
            col: from.col,
            rowSpan: to.row - from.row + 1,
            colSpan: to.col - from.col + 1,
          });
        }
        break;
      case "fill":
        for (const token of tokens) {
          const eq = token.indexOf("=");
          const ref = eq > 0 ? parseCellRef(token.slice(0, eq)) : null;
          if (ref && token.length > eq + 1) meta.fills.push({ ...ref, color: token.slice(eq + 1) });
        }
        break;
      case "noborder":
        for (const group of tokens.join(" ").split(",")) {
          const [ref, ...sides] = group.trim().split(/\s+/);
          const at = ref ? parseCellRef(ref) : null;
          const known = sides
            .map((s) => s.toLowerCase())
            .filter((s): s is Side => (SIDES as readonly string[]).includes(s));
          if (at && known.length > 0) meta.hidden.push({ ...at, sides: known });
        }
        break;
      default:
        break;
    }
  }

  return meta;
}

/** The table with its comment's widths, merges, fills and borders applied. */
function applyMetaToTable(table: Table, comment: string): Table {
  const meta = parseMeta(comment);
  if (!meta) return table;

  // Work on the pipe grid: every row as read, cells addressed by position.
  const rows: Cell[][] = table.children.map((row) => [...(row.children as Cell[])]);
  const at = (row: number, col: number): Cell | undefined => rows[row]?.[col];
  const set = (row: number, col: number, patch: Partial<Cell>) => {
    const cell = at(row, col);
    if (cell) rows[row][col] = { ...cell, ...patch };
  };

  for (const fill of meta.fills) set(fill.row, fill.col, { background: fill.color });
  for (const hide of meta.hidden) {
    const cell = at(hide.row, hide.col);
    if (!cell) continue;
    const borders = { ...(cell.borders ?? {}) };
    for (const side of hide.sides) borders[side] = { ...(borders[side] ?? {}), size: 0 };
    set(hide.row, hide.col, { borders });
  }

  const covered = new Set<string>();
  for (const merge of meta.merges) {
    if (!at(merge.row, merge.col)) continue;
    const rowSpan = Math.min(merge.rowSpan, rows.length - merge.row);
    const colSpan = Math.min(
      merge.colSpan,
      Math.max(...rows.map((r) => r.length)) - merge.col,
    );
    if (rowSpan < 1 || colSpan < 1 || (rowSpan === 1 && colSpan === 1)) continue;
    set(merge.row, merge.col, {
      ...(colSpan > 1 ? { colSpan } : {}),
      ...(rowSpan > 1 ? { rowSpan } : {}),
    });
    for (let r = merge.row; r < merge.row + rowSpan; r += 1) {
      for (let c = merge.col; c < merge.col + colSpan; c += 1) {
        if (r !== merge.row || c !== merge.col) covered.add(`${r}:${c}`);
      }
    }
  }

  const children = (table.children as TElement[]).map(
    (row, r): TElement => ({
      ...row,
      children: rows[r].filter((_, c) => !covered.has(`${r}:${c}`)),
    }),
  );

  const cols = Math.max(...rows.map((r) => r.length));
  return {
    ...table,
    ...(meta.widths.length === cols ? { colSizes: meta.widths } : {}),
    ...(meta.percents.length === cols ? { colPercents: meta.percents } : {}),
    children,
  };
}

/**
 * Folds each `<!-- netherstone: … -->` comment into the table under it. A
 * comment with no table after it stays a raw block.
 */
export function applyTableMeta<T>(value: T): T {
  if (!Array.isArray(value)) return value;

  let changed = false;
  const next: unknown[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];
    const following = value[index + 1];

    if (isRawBlock(node) && TABLE_META.test(node.value.trim()) && isTable(following)) {
      next.push(applyMetaToTable(following, node.value));
      index += 1;
      changed = true;
      continue;
    }

    if (node && typeof node === "object" && Array.isArray((node as TElement).children)) {
      const children = applyTableMeta((node as TElement).children);
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

/** The raw block carrying a table's comment, for the save pre-pass. */
export function tableMetaBlock(meta: string) {
  return createRawBlockNode(meta);
}

// ── Column alignment ──────────────────────────────────────────────────────────

type Align = "left" | "center" | "right" | null;

function columnAlignOf(cell: Cell | undefined): Align {
  const paragraph = cell?.children.find(
    (child) => (child as TElement).type === "p",
  ) as (TElement & { align?: string }) | undefined;
  switch (paragraph?.align) {
    case "left":
    case "center":
    case "right":
      return paragraph.align;
    case "end":
      return "right";
    default:
      return null;
  }
}

function alignCell(cell: TElement, align: Align): TElement {
  if (!align) return cell;
  return {
    ...cell,
    children: cell.children.map((child) =>
      (child as TElement).type === "p" ? { ...(child as TElement), align } : child,
    ),
  };
}

export const tableRules: MdRules = {
  table: {
    deserialize: (node, deco, options) => {
      const table = defaultRules.table!.deserialize!(node, deco, options) as Table;
      const aligns = (node as { align?: (string | null)[] }).align ?? [];
      if (!aligns.some(Boolean)) return table as never;
      return {
        ...table,
        children: table.children.map((row: TElement) => ({
          ...row,
          children: (row.children as TElement[]).map((cell, col) =>
            alignCell(cell, (aligns[col] as Align) ?? null),
          ),
        })),
      } as never;
    },
    serialize: (node, options) => {
      const result = defaultRules.table!.serialize!(node, options) as {
        align?: (string | null)[];
      };
      const header = ((node as Table).children[0]?.children ?? []) as Cell[];
      const aligns = header.map(columnAlignOf);
      return (aligns.some(Boolean) ? { ...result, align: aligns } : result) as never;
    },
  },
};
