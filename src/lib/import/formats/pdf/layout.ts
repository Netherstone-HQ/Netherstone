import {
  codeBlock,
  heading,
  image,
  isTextColor,
  link,
  listItem,
  paragraph,
  table,
  text,
  type Align,
  type ListType,
  type Marks,
} from "../../nodes";
import type { PlateNode } from "../../types";
import type { PageData, PagePicture, PageRule, TextPiece } from "./extract";

/**
 * Turns the text pieces of a PDF's pages back into a document. A PDF only
 * says where each piece of text is drawn, so structure is rebuilt from how
 * it looks:
 *
 * - pieces on one baseline form a line, in the order the PDF draws them,
 *   which follows the reading order (columns included) in nearly every PDF;
 * - running headers, footers and page numbers repeated across pages go;
 * - lines join into paragraphs until the spacing, size or indent changes,
 *   and words hyphenated across lines are joined again;
 * - text larger than the body becomes headings, largest first, and short
 *   bold lines on their own become the smallest heading;
 * - lines starting with a bullet or a number become list items, nested by
 *   how far they're indented;
 * - monospaced lines become code blocks with their indentation;
 * - centred lines stay centred;
 * - pictures go where they sit on the page.
 */

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  mono: boolean;
  superscript: boolean;
  subscript: boolean;
  href?: string;
  color?: string;
}

interface Segment {
  x: number;
  right: number;
  runs: Run[];
  text: string;
}

interface Line {
  page: number;
  x: number;
  right: number;
  y: number;
  size: number;
  runs: Run[];
  text: string;
  bold: boolean;
  mono: boolean;
  /** Every text size in the line, to half a point. */
  sizes: number[];
  /** Stretches of the line separated by wide gaps: table cells, tab stops. */
  segments: Segment[];
  /** Ends well before the column's right edge, so its line break is real. */
  short?: boolean;
  /** Where a bullet drawn as a shape sits in front of the line. */
  bulletX?: number;
  pieces: TextPiece[];
}

type ListMarker = { type: ListType; start?: number; checked?: boolean; length: number };

const BULLET = /^([•●◦○▪■‣⁃∙·◆◇►▸➢➤-]|\*|–|\uf0b7|\uf0a7)\s+/;
const CHECKBOX = /^([☐☑☒✓✔□])\s*/;
const ORDERED = /^(\(?(\d{1,3})[.)]|\(?([a-z])[.)]|\(?([ivxlc]{1,6})[.)])\s+/i;
const SENTENCE_END = /[.!?:;"”’)\]]$/;
const PAGE_NUMBER = /^(page\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?(\s*(of|\/)\s*\d{1,4})?$/i;

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The value most characters share, to half a point. */
function weightedMode(values: { value: number; weight: number }[]) {
  const totals = new Map<number, number>();
  for (const { value, weight } of values) {
    const key = Math.round(value * 2) / 2;
    totals.set(key, (totals.get(key) ?? 0) + weight);
  }
  let best = 0;
  let bestWeight = -1;
  for (const [key, weight] of totals) {
    if (weight > bestWeight) {
      best = key;
      bestWeight = weight;
    }
  }
  return best;
}

// ── Lines ────────────────────────────────────────────────────────────────────

function buildLines(page: PageData, pageIndex: number): Line[] {
  const lines: Line[] = [];
  let current: { pieces: TextPiece[]; y: number; size: number; right: number } | null = null;

  const finish = () => {
    if (!current) return;
    const line = toLine(current.pieces, pageIndex);
    if (line.text.trim()) lines.push(line);
    current = null;
  };

  for (const piece of page.pieces) {
    if (!current) {
      current = { pieces: [piece], y: piece.y, size: piece.size, right: piece.x + piece.width };
      continue;
    }
    const tolerance = Math.max(current.size, piece.size) * 0.5;
    const sameBaseline = Math.abs(piece.y - current.y) <= tolerance;
    const goesBack = piece.x < current.right - Math.max(current.size, piece.size) * 1.5;
    if (!sameBaseline || goesBack) {
      finish();
      current = { pieces: [piece], y: piece.y, size: piece.size, right: piece.x + piece.width };
      continue;
    }
    current.pieces.push(piece);
    current.right = Math.max(current.right, piece.x + piece.width);
    if (piece.size > current.size && piece.text.trim()) {
      current.size = piece.size;
      current.y = piece.y;
    }
  }
  finish();
  return lines;
}

/**
 * `cellGap` is the gap, in text sizes, that splits a line into segments;
 * tables set closely can need a smaller one than prose can bear.
 */
function toLine(pieces: TextPiece[], page: number, cellGap = 1.5): Line {
  const visible = pieces.filter((piece) => piece.text.trim());
  const size = weightedMode(visible.map((piece) => ({ value: piece.size, weight: piece.text.length }))) || pieces[0].size;
  const sizes = [...new Set(visible.map((piece) => Math.round(piece.size * 2) / 2))];
  const baseline = median(visible.filter((piece) => Math.abs(piece.size - size) < 0.6).map((piece) => piece.y)) || pieces[0].y;

  const segments: Segment[] = [];
  let segment: Segment | null = null;
  let previousRight: number | null = null;
  let spaceBefore = false;
  for (const piece of pieces) {
    // pdf.js fills gaps between words with space pieces as wide as the gap;
    // the gap itself is what tells cells apart.
    if (!piece.text.trim()) {
      spaceBefore = true;
      continue;
    }
    let value = piece.text;
    const gap = previousRight === null ? 0 : piece.x - previousRight;
    if (!segment || gap > Math.max(piece.size, size) * cellGap) {
      segment = { x: piece.x, right: piece.x + piece.width, runs: [], text: "" };
      segments.push(segment);
      value = value.replace(/^\s+/, "");
    } else {
      const last = segment.runs[segment.runs.length - 1];
      const endsWithSpace = !last || /\s$/.test(last.text);
      if ((spaceBefore || gap > piece.size * 0.15) && !endsWithSpace && !/^\s/.test(value)) value = ` ${value}`;
    }
    spaceBefore = false;
    previousRight = piece.x + piece.width;
    segment.right = Math.max(segment.right, previousRight);
    // Smaller text off the baseline is a superscript (footnote marks,
    // exponents) or a subscript.
    const smaller = piece.size < size * 0.9 && value.trim().length <= 4;
    const superscript = smaller && baseline - piece.y > size * 0.15;
    const subscript = smaller && piece.y - baseline > size * 0.08;
    const run: Run = { text: value, bold: piece.bold, italic: piece.italic, mono: piece.mono, superscript, subscript, href: piece.href, color: piece.color };
    const last = segment.runs[segment.runs.length - 1];
    if (
      last &&
      last.bold === run.bold &&
      last.italic === run.italic &&
      last.mono === run.mono &&
      last.superscript === run.superscript &&
      last.subscript === run.subscript &&
      last.href === run.href &&
      (last.color === run.color || !/\S/.test(run.text))
    ) {
      last.text += run.text;
    } else {
      segment.runs.push(run);
    }
  }
  for (const part of segments) part.text = part.runs.map((run) => run.text).join("").replace(/\s+/g, " ").trim();

  const runs: Run[] = [];
  segments.forEach((part, index) => {
    if (index > 0) runs.push({ text: " ", bold: false, italic: false, mono: false, superscript: false, subscript: false });
    runs.push(...part.runs.map((run) => ({ ...run })));
  });

  const text = runs.map((run) => run.text).join("").replace(/\s+/g, " ").trim();
  // Symbols and emoji often come from a fixed-width fallback font; only
  // words say whether a line is code.
  const words = visible.filter((piece) => /\w/.test(piece.text));
  return {
    page,
    x: Math.min(...visible.map((piece) => piece.x), pieces[0].x),
    right: Math.max(...pieces.map((piece) => piece.x + piece.width)),
    y: baseline,
    size,
    runs,
    text,
    bold: words.length > 0 && words.every((piece) => piece.bold),
    mono: words.length > 0 && words.every((piece) => piece.mono),
    sizes,
    segments: segments.filter((part) => part.text),
    pieces,
  };
}

// ── Tables with borders ──────────────────────────────────────────────────────

interface RuledTable {
  top: number;
  bottom: number;
  left: number;
  right: number;
  node: PlateNode;
}

/** Values within `tolerance` of each other as one, sorted. */
function cluster(values: number[], tolerance: number) {
  const out: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    if (!out.length || value - out[out.length - 1] > tolerance) out.push(value);
  }
  return out;
}

/**
 * Tables drawn with borders, found from the lines on the page: horizontal
 * and vertical lines that cross make a grid, and the text inside each box
 * is a cell. A border missing inside the grid means a merged cell. A lone
 * box (a framed note) isn't a table.
 */
function findRuledTables(page: PageData, pageIndex: number): RuledTable[] {
  const horizontal = page.rules.filter((rule) => rule.y2 - rule.y1 < 1.5);
  const vertical = page.rules.filter((rule) => rule.x2 - rule.x1 < 1.5);
  if (!horizontal.length || !vertical.length) return [];

  // Group lines that cross into grids.
  const all: PageRule[] = [...horizontal, ...vertical];
  const parent = all.map((_, index) => index);
  const root = (index: number): number => (parent[index] === index ? index : (parent[index] = root(parent[index])));
  horizontal.forEach((h, hi) => {
    vertical.forEach((v, vi) => {
      if (v.x1 >= h.x1 - 2 && v.x1 <= h.x2 + 2 && h.y1 >= v.y1 - 2 && h.y1 <= v.y2 + 2) parent[root(hi)] = root(horizontal.length + vi);
    });
  });
  const groups = new Map<number, PageRule[]>();
  all.forEach((rule, index) => groups.set(root(index), [...(groups.get(root(index)) ?? []), rule]));

  const tables: RuledTable[] = [];
  for (const rules of groups.values()) {
    const hs = rules.filter((rule) => rule.y2 - rule.y1 < 1.5);
    const vs = rules.filter((rule) => rule.x2 - rule.x1 < 1.5);
    const xs = cluster(vs.map((rule) => rule.x1), 2.5);
    const ys = cluster(hs.map((rule) => rule.y1), 2.5);
    if (xs.length < 2 || ys.length < 2 || (xs.length - 1) * (ys.length - 1) < 2) continue;
    if (xs[xs.length - 1] - xs[0] < 40) continue;

    const rows = ys.length - 1;
    const columns = xs.length - 1;
    const hasVertical = (x: number, top: number, bottom: number) =>
      vs.some((rule) => Math.abs(rule.x1 - x) <= 2.5 && rule.y1 <= top + 2 && rule.y2 >= bottom - 2);
    const hasHorizontal = (y: number, left: number, right: number) =>
      hs.some((rule) => Math.abs(rule.y1 - y) <= 2.5 && rule.x1 <= left + 2 && rule.x2 >= right - 2);

    // Which piece of text sits in which box.
    const boxes: TextPiece[][][] = Array.from({ length: rows }, () => Array.from({ length: columns }, () => []));
    const indexIn = (edges: number[], value: number) => edges.findIndex((edge, index) => index < edges.length - 1 && value >= edge && value < edges[index + 1]);
    for (const piece of page.pieces) {
      const row = indexIn(ys, piece.y - piece.size / 3);
      const column = indexIn(xs, piece.x + Math.min(piece.width, piece.size) / 2);
      if (row >= 0 && column >= 0) boxes[row][column].push(piece);
    }

    // Merged cells: boxes joined where the border between them is missing.
    const covered = boxes.map((row) => row.map(() => false));
    const cells: { row: number; column: number; colSpan: number; rowSpan: number; pieces: TextPiece[] }[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (covered[row][column]) continue;
        let colSpan = 1;
        while (column + colSpan < columns && !hasVertical(xs[column + colSpan], ys[row], ys[row + 1])) colSpan += 1;
        let rowSpan = 1;
        while (row + rowSpan < rows && !hasHorizontal(ys[row + rowSpan], xs[column], xs[column + colSpan])) rowSpan += 1;
        const pieces: TextPiece[] = [];
        for (let r = row; r < row + rowSpan; r += 1) {
          for (let c = column; c < column + colSpan; c += 1) {
            covered[r][c] = true;
            pieces.push(...boxes[r][c]);
          }
        }
        cells.push({ row, column, colSpan, rowSpan, pieces });
      }
    }
    if (cells.length < 2) continue;

    const cellLines = (pieces: TextPiece[]) => buildLines({ ...page, pieces }, pageIndex);
    const firstRow = cells.filter((cell) => cell.row === 0);
    const header = rows > 1 && firstRow.every((cell) => cellLines(cell.pieces).every((line) => line.bold));
    const tableRows = Array.from({ length: rows }, (_, row) =>
      cells
        .filter((cell) => cell.row === row)
        .map((cell) => ({
          header: header && row === 0,
          colSpan: cell.colSpan,
          rowSpan: cell.rowSpan,
          children: cellParagraphs(cellLines(cell.pieces), { headingText: header && row === 0 }),
        })),
    ).filter((row) => row.length);

    tables.push({ top: ys[0], bottom: ys[ys.length - 1], left: xs[0], right: xs[xs.length - 1], node: table(tableRows) });
  }
  return tables;
}

/** A cell's lines as paragraphs, split where the gap between lines grows. */
function cellParagraphs(lines: Line[], options: { headingText?: boolean }): PlateNode[] {
  const groups: Line[][] = [];
  lines.forEach((line, index) => {
    const previous = lines[index - 1];
    if (!previous || line.y - previous.y > Math.max(line.size, previous.size) * 1.6) groups.push([line]);
    else groups[groups.length - 1].push(line);
  });
  return groups.map((group) => paragraph(inlines(group, options)));
}

// ── Headers and footers ──────────────────────────────────────────────────────

function removeFurniture(pages: PageData[], lines: Line[][]): Line[][] {
  const margin = (page: PageData, line: Line) => line.y < page.height * 0.09 || line.y > page.height * 0.91;
  const key = (line: Line) => line.text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const counts = new Map<string, number>();
  lines.forEach((pageLines, index) => {
    const seen = new Set<string>();
    for (const line of pageLines) if (margin(pages[index], line)) seen.add(key(line));
    for (const value of seen) counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  const repeated = (line: Line) => pages.length >= 3 && (counts.get(key(line)) ?? 0) >= Math.max(2, pages.length * 0.4);

  return lines.map((pageLines, index) =>
    pageLines.filter((line) => !(margin(pages[index], line) && (repeated(line) || PAGE_NUMBER.test(line.text)))),
  );
}

// ── Blocks ───────────────────────────────────────────────────────────────────

type BlockKind = "paragraph" | "heading" | "list" | "code" | "table";

interface Block {
  kind: BlockKind;
  lines: Line[];
  marker?: ListMarker;
  align?: Align;
  /** Left edges of a table's columns. */
  columns?: number[];
}

/**
 * Runs of two or more lines split into cells at the same places: tables.
 * Each line is a row; a cell goes in the last column starting at or before
 * it. Wide cells mean text columns, not a table, and are left alone.
 */
function findTables(lines: Line[], pageWidth: number): { start: number; end: number; columns: number[] }[] {
  const ranges: { start: number; end: number; columns: number[] }[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index].segments.length < 2) {
      index += 1;
      continue;
    }
    let end = index;
    while (end + 1 < lines.length) {
      const next = lines[end + 1];
      const gap = next.y - lines[end].y;
      if (gap <= 0 || gap > lines[end].size * 3.5) break;
      // One-cell lines close below a row are a cell's text wrapping.
      if (next.segments.length >= 2 || gap < lines[end].size * 1.6) end += 1;
      else break;
    }
    const group = lines.slice(index, end + 1);
    const starts = group.flatMap((line) => line.segments.map((segment) => segment.x)).sort((a, b) => a - b);
    const columns: number[] = [];
    for (const x of starts) if (!columns.length || x - columns[columns.length - 1] > 8) columns.push(x);
    const shared = columns.filter((column) => group.filter((line) => line.segments.some((segment) => Math.abs(segment.x - column) <= 8)).length >= Math.max(2, group.length * 0.5));
    const averageWidth =
      group.flatMap((line) => line.segments.map((segment) => segment.right - segment.x)).reduce((sum, width) => sum + width, 0) /
      Math.max(1, group.reduce((sum, line) => sum + line.segments.length, 0));
    // Trailing one-cell lines belong only if they line up with a column.
    let last = end;
    while (last > index && lines[last].segments.length < 2 && !lines[last].segments.every((segment) => shared.some((column) => Math.abs(segment.x - column) <= 8))) {
      last -= 1;
    }
    const rows = lines.slice(index, last + 1).filter((line) => line.segments.length >= 2).length;
    if (rows >= 2 && shared.length >= 2 && averageWidth < pageWidth * 0.3) {
      ranges.push({ start: index, end: last, columns: shared });
    }
    index = end + 1;
  }
  return ranges;
}

/**
 * Tables without borders whose columns sit closer than `findTables` needs:
 * three or more lines in a row that split at smaller gaps, all at the same
 * places. Prose never lines its word gaps up like that. The lines take the
 * finer split for their cells.
 */
function findCloseTables(lines: Line[], pageWidth: number) {
  const ranges: { start: number; end: number; columns: number[] }[] = [];
  const split = lines.map((line) => toLine(line.pieces, line.page, 0.5).segments);
  let index = 0;
  while (index < lines.length) {
    let end = index - 1;
    while (
      end + 1 < lines.length &&
      split[end + 1].length >= 2 &&
      !lines[end + 1].mono &&
      (end < index || (lines[end + 1].y > lines[end].y && lines[end + 1].y - lines[end].y <= lines[end].size * 3.5))
    ) {
      end += 1;
    }
    if (end - index + 1 >= 3) {
      const group = split.slice(index, end + 1);
      const columns = cluster(group.flatMap((segments) => segments.map((segment) => segment.x)), 3);
      const shared = columns.filter((column) => group.filter((segments) => segments.some((segment) => Math.abs(segment.x - column) <= 3)).length >= group.length * 0.6);
      const aligned = group.every((segments) => segments.every((segment) => shared.some((column) => Math.abs(segment.x - column) <= 3)));
      const widths = group.flat().map((segment) => segment.right - segment.x);
      const narrow = widths.reduce((sum, width) => sum + width, 0) / widths.length < pageWidth * 0.3;
      if (aligned && shared.length >= 2 && narrow) {
        for (let line = index; line <= end; line += 1) lines[line].segments = split[line];
        ranges.push({ start: index, end, columns: shared });
        index = end + 1;
        continue;
      }
    }
    index = Math.max(index + 1, end + 1);
  }
  return ranges;
}

function listMarker(textValue: string): ListMarker | null {
  const checkbox = CHECKBOX.exec(textValue);
  if (checkbox) return { type: "todo", checked: /[☑☒✓✔]/.test(checkbox[1]), length: checkbox[1].length };
  const bullet = BULLET.exec(textValue);
  if (bullet) {
    // A dash starting a sentence after a line break is common prose; only
    // take it when followed by text.
    return { type: "disc", length: bullet[0].trimEnd().length };
  }
  const ordered = ORDERED.exec(textValue);
  if (ordered) {
    if (ordered[2]) return { type: "decimal", start: Number(ordered[2]), length: ordered[0].trimEnd().length };
    if (ordered[3]) {
      const letter = ordered[3];
      // "A. Smith" or "I. Introduction" read as names and sections, not lists, unless lowercase.
      if (letter === letter.toUpperCase()) return null;
      return { type: "lower-alpha", start: letter.charCodeAt(0) - 96, length: ordered[0].trimEnd().length };
    }
    if (ordered[4] && ordered[4] === ordered[4].toLowerCase()) {
      return { type: "lower-roman", start: romanValue(ordered[4]), length: ordered[0].trimEnd().length };
    }
  }
  return null;
}

function romanValue(value: string) {
  const values: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const current = values[value[index]];
    const next = values[value[index + 1]] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

export interface LayoutResult {
  nodes: PlateNode[];
  hasText: boolean;
}

/**
 * Keeps only colours someone picked: the colour most of the text is in,
 * black and near-black are the ordinary text colour, and near-white text sat
 * on a coloured box that doesn't come along.
 */
function keepPickedColors(pages: PageData[]) {
  const pieces = pages.flatMap((page) => page.pieces);
  const amounts = new Map<string, number>();
  for (const piece of pieces) if (piece.color) amounts.set(piece.color, (amounts.get(piece.color) ?? 0) + piece.text.length);
  const body = [...amounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const nearWhite = (color: string) => Math.min(...[1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16))) > 0xe0;
  for (const piece of pieces) {
    if (piece.color && (piece.color === body || isTextColor(piece.color) || nearWhite(piece.color))) delete piece.color;
  }
}

export function layoutPages(pages: PageData[]): LayoutResult {
  keepPickedColors(pages);
  const ruled = pages.map((page, index) => findRuledTables(page, index));
  const inRuledTable = (piece: TextPiece, tables: RuledTable[]) =>
    tables.some((box) => piece.x >= box.left - 2 && piece.x <= box.right + 2 && piece.y - piece.size / 3 >= box.top - 2 && piece.y - piece.size / 3 <= box.bottom + 2);
  const allLines = removeFurniture(
    pages,
    pages.map((page, index) => buildLines({ ...page, pieces: page.pieces.filter((piece) => !inRuledTable(piece, ruled[index])) }, index)),
  );
  const flat = allLines.flat();
  if (!flat.length && !ruled.some((tables) => tables.length)) {
    return { nodes: pages.flatMap((page) => page.pictures.map(pictureNode)), hasText: false };
  }

  const bodySize = weightedMode(flat.map((line) => ({ value: line.size, weight: line.text.length })));
  const headingSizes = [...new Set(flat.filter((line) => line.size >= bodySize * 1.15 && line.text.length <= 200).map((line) => Math.round(line.size)))].sort(
    (a, b) => b - a,
  );
  const levelOf = (size: number) => {
    const index = headingSizes.indexOf(Math.round(size));
    return index < 0 ? null : Math.min(index + 1, 5);
  };
  const boldHeadingLevel = Math.min(headingSizes.length + 1, 6);

  // Typical distance between lines of body text, for paragraph breaks.
  const gaps: number[] = [];
  for (const pageLines of allLines) {
    for (let index = 1; index < pageLines.length; index += 1) {
      const a = pageLines[index - 1];
      const b = pageLines[index];
      if (Math.abs(a.size - bodySize) < 0.6 && Math.abs(b.size - bodySize) < 0.6 && b.y > a.y) gaps.push(b.y - a.y);
    }
  }
  const lineGap = median(gaps) || bodySize * 1.3;

  const nodes: PlateNode[] = [];
  let previousBlock: Block | null = null;

  allLines.forEach((pageLines, pageIndex) => {
    const page = pages[pageIndex];
    const left = median(pageLines.filter((line) => Math.abs(line.size - bodySize) < 0.6).map((line) => line.x)) || 0;
    // The width of a full line of body text: a column's width.
    const bodyWidths = pageLines.filter((line) => Math.abs(line.size - bodySize) < 0.6).map((line) => line.right - line.x).sort((a, b) => a - b);
    const columnWidth = bodyWidths[Math.floor(bodyWidths.length * 0.9)] ?? Math.max(...pageLines.map((line) => line.right - line.x), 1);
    for (const line of pageLines) {
      line.short = line.right - line.x < columnWidth * 0.75;
      const mark = page.marks.find(
        (candidate) =>
          candidate.height >= line.size * 0.1 &&
          candidate.height <= line.size * 0.8 &&
          candidate.x + candidate.width < line.x - 1 &&
          candidate.x + candidate.width > line.x - line.size * 3 &&
          candidate.y + candidate.height / 2 < line.y &&
          candidate.y + candidate.height / 2 > line.y - line.size * 0.9,
      );
      if (mark) line.bulletX = mark.x;
    }
    // Close-set tables first: they only take lines that line up exactly.
    const tableRanges = findCloseTables(pageLines, page.width);
    tableRanges.push(
      ...findTables(pageLines, page.width).filter((range) => !tableRanges.some((close) => range.start <= close.end && close.start <= range.end)),
    );

    // List nesting: the distinct indents list markers start at on this page.
    const markerX = (line: Line) => line.bulletX ?? line.x;
    const markerIndents = [...new Set(pageLines.filter((line) => line.bulletX !== undefined || listMarker(line.text)).map((line) => Math.round(markerX(line) / 6) * 6))].sort(
      (a, b) => a - b,
    );

    const blocks: Block[] = [];
    let current: Block | null = null;

    const kindOf = (line: Line): { kind: BlockKind; marker?: ListMarker } => {
      if (line.mono) return { kind: "code" };
      if (line.bulletX !== undefined) return { kind: "list", marker: { type: "disc", length: 0 } };
      const marker = listMarker(line.text);
      // Headings start with a capital, a number or a symbol, not mid-sentence.
      const headingSized = levelOf(line.size) !== null && line.size >= bodySize * 1.15 && !/^\p{Ll}/u.test(line.text);
      // "1. Sales" in a heading's size is a numbered heading, not a list.
      if (headingSized && (!marker || (marker.type !== "disc" && marker.type !== "todo" && line.text.length <= 120))) return { kind: "heading" };
      if (marker && line.text.length > marker.length) return { kind: "list", marker };
      return { kind: "paragraph" };
    };

    for (let index = 0; index < pageLines.length; index += 1) {
      const range = tableRanges.find((candidate) => candidate.start === index);
      if (range) {
        current = { kind: "table", lines: pageLines.slice(range.start, range.end + 1), columns: range.columns };
        blocks.push(current);
        current = null;
        index = range.end;
        continue;
      }
      const line = pageLines[index];
      const previous = pageLines[index - 1];
      const { kind, marker } = kindOf(line);

      if (current) {
        const gap = previous ? line.y - previous.y : 0;
        const sameKind = current.kind === kind || (current.kind === "list" && kind === "paragraph" && line.x > current.lines[0].x + 2);
        const spacingBreak = gap > lineGap * 1.45 || gap < -line.size;
        // A line with a word or two in another size (a date chip, a big
        // number) still belongs to the paragraph if it shares its size.
        const sizeBreak = !line.sizes.some((value) => Math.abs(value - current!.lines[0].size) <= 1);
        // A paragraph's last line stops short; what follows starts a new one
        // if it reads like a new sentence.
        const shortBefore = previous && previous.short && (SENTENCE_END.test(previous.text) || /^\p{Lu}/u.test(line.text));
        const firstLineIndent = kind === "paragraph" && current.kind === "paragraph" && line.x > left + line.size * 1.2 && previous && previous.x <= left + 2;
        const boldBreak = current.kind === "paragraph" && current.lines.every((l) => l.bold) !== line.bold && current.lines.length === 1;
        const continuesHeading = current.kind === "heading" && kind === "heading" && !spacingBreak && current.lines.length < 3;
        // Big words that wrapped onto a line of their own, right under a
        // full line of the paragraph, are still the paragraph.
        const wrappedBigWords =
          current.kind === "paragraph" && (kind === "heading" || kind === "paragraph") && previous && !previous.short && gap > 0 && gap <= line.size * 1.4;

        if (wrappedBigWords) {
          current.lines.push(line);
          continue;
        }
        if (continuesHeading || (sameKind && kind !== "list" && kind !== "heading" && !spacingBreak && !sizeBreak && !(kind === "paragraph" && (shortBefore || firstLineIndent || boldBreak)))) {
          current.lines.push(line);
          continue;
        }
        // A wrapped list item: indented past its marker, no marker of its own.
        if (current.kind === "list" && kind === "paragraph" && !spacingBreak && line.x > current.lines[0].x + 2) {
          current.lines.push(line);
          continue;
        }
      }

      current = { kind, lines: [line], marker };
      blocks.push(current);
    }

    // Pictures and tables with borders go before the first block that
    // starts below them.
    const placed = [
      ...page.pictures.map((picture) => ({ y: picture.y + picture.height / 2, node: pictureNode(picture) })),
      ...ruled[pageIndex].map((box) => ({ y: box.top, node: box.node })),
    ].sort((a, b) => a.y - b.y);
    const output: (Block | { node: PlateNode })[] = [];
    let placedIndex = 0;
    for (const block of blocks) {
      while (placedIndex < placed.length && placed[placedIndex].y < block.lines[0].y) {
        output.push(placed[placedIndex]);
        placedIndex += 1;
      }
      output.push(block);
    }
    output.push(...placed.slice(placedIndex));

    for (const item of output) {
      if (!("kind" in item)) {
        nodes.push(item.node);
        previousBlock = null;
        continue;
      }
      const block = item;

      // A paragraph cut by the page break carries on.
      if (
        previousBlock &&
        block === blocks[0] &&
        block.kind === "paragraph" &&
        previousBlock.kind === "paragraph" &&
        !SENTENCE_END.test(previousBlock.lines[previousBlock.lines.length - 1].text) &&
        Math.abs(block.lines[0].size - previousBlock.lines[0].size) < 0.6 &&
        nodes.length > 0
      ) {
        previousBlock.lines.push(...block.lines);
        nodes[nodes.length - 1] = paragraphNode(previousBlock, bodySize);
        continue;
      }

      block.align = alignmentOf(block, page.width, left, columnWidth);
      const node = blockNode(block, {
        bodySize,
        levelOf,
        boldHeadingLevel,
        depthOf: (line) => Math.max(1, markerIndents.findIndex((indent) => Math.abs(indent - Math.round(markerX(line) / 6) * 6) < 7) + 1),
      });
      if (node) nodes.push(node);
      previousBlock = block;
    }
  });

  return { nodes, hasText: true };
}

function alignmentOf(block: Block, pageWidth: number, left: number, columnWidth: number): Align | undefined {
  if (block.kind === "code" || block.kind === "list") return undefined;
  const centred = block.lines.every((line) => {
    const middle = (line.x + line.right) / 2;
    return Math.abs(middle - pageWidth / 2) < pageWidth * 0.03 && line.x > left + line.size * 2;
  });
  if (centred) return "center";
  const rightEdge = Math.max(...block.lines.map((line) => line.right));
  const rightAligned =
    block.lines.length > 0 &&
    block.lines.every((line) => Math.abs(line.right - rightEdge) < 2 && line.x > left + columnWidth * 0.35);
  return rightAligned ? "right" : undefined;
}

function pictureNode(picture: PagePicture): PlateNode {
  // Page units are points; the editor sizes pictures in CSS pixels. A
  // picture as wide as the page just fills the column.
  const width = (picture.width * 4) / 3;
  return image(picture.url, { width: width > 720 ? undefined : width });
}

interface BlockOptions {
  bodySize: number;
  levelOf: (size: number) => number | null;
  boldHeadingLevel: number;
  depthOf: (line: Line) => number;
}

function blockNode(block: Block, options: BlockOptions): PlateNode | null {
  switch (block.kind) {
    case "table": {
      const columns = block.columns!;
      const cellOf = (x: number) => {
        let column = 0;
        for (let candidate = 0; candidate < columns.length; candidate += 1) {
          if (x >= columns[candidate] - 8) column = candidate;
        }
        return column;
      };
      const rows: { header: boolean; cells: PlateNode[][] }[] = [];
      block.lines.forEach((line, index) => {
        const previous = block.lines[index - 1];
        // Text wrapping inside a cell sits a line below with only one cell
        // filled; a new row fills its first cell or sits further down.
        const wraps = previous && line.segments.length === 1 && line.y - previous.y < previous.size * 1.6;
        if (!wraps) rows.push({ header: index === 0 && line.bold && block.lines.length > 1, cells: columns.map(() => []) });
        const row = rows[rows.length - 1];
        for (const segment of line.segments) {
          const cell = row.cells[cellOf(segment.x)];
          if (cell.length) cell.push(text(wraps ? "\n" : " "));
          cell.push(...inlines([{ ...line, runs: segment.runs, segments: [segment] }], { headingText: row.header }));
        }
      });
      return table(rows.map((row) => row.cells.map((content) => ({ header: row.header, children: [paragraph(content)] }))));
    }
    case "code": {
      const charWidth = block.lines[0].size * 0.6;
      const minX = Math.min(...block.lines.map((line) => line.x));
      return codeBlock(
        block.lines.map((line) => " ".repeat(Math.max(0, Math.round((line.x - minX) / charWidth))) + line.runs.map((run) => run.text).join("").trimEnd()),
      );
    }
    case "heading": {
      const level = options.levelOf(block.lines[0].size) ?? 1;
      return heading(level, inlines(block.lines, { headingText: true }), { align: block.align });
    }
    case "list": {
      const marker = block.marker!;
      const content = inlines(block.lines, { skip: marker.length });
      return listItem(content, {
        type: marker.type,
        depth: options.depthOf(block.lines[0]),
        start: marker.start,
        checked: marker.checked,
      });
    }
    default: {
      const only = block.lines.length === 1 ? block.lines[0] : null;
      if (only && only.bold && only.text.length <= 100 && !SENTENCE_END.test(only.text) && Math.abs(only.size - options.bodySize) < 0.6 && /\p{L}/u.test(only.text)) {
        return heading(options.boldHeadingLevel, inlines(block.lines, { headingText: true }), { align: block.align });
      }
      return paragraphNode(block, options.bodySize);
    }
  }
}

function paragraphNode(block: Block, _bodySize: number): PlateNode {
  return paragraph(inlines(block.lines), { align: block.align });
}

/**
 * The lines' runs as inline nodes: lines joined with spaces, words broken
 * with a hyphen at a line end joined again.
 */
function inlines(lines: Line[], options: { skip?: number; headingText?: boolean } = {}): PlateNode[] {
  const out: PlateNode[] = [];
  let skip = options.skip ?? 0;

  lines.forEach((line, lineIndex) => {
    const runs = line.runs.map((run) => ({ ...run }));
    if (lineIndex === 0 && runs.length) runs[0].text = runs[0].text.replace(/^\s+/, "");
    // Drop the list marker.
    while (skip > 0 && runs.length) {
      const first = runs[0];
      const trimmed = first.text.replace(/^\s+/, "");
      const cut = Math.min(skip, trimmed.length);
      first.text = trimmed.slice(cut);
      skip -= cut;
      if (!first.text) runs.shift();
    }

    const last = out[out.length - 1];
    if (lineIndex > 0 && last && typeof last.text === "string") {
      const nextText = runs.map((run) => run.text).join("").trimStart();
      if (/\p{L}-$/u.test(last.text) && /^\p{Ll}/u.test(nextText)) {
        last.text = last.text.slice(0, -1);
        if (runs[0]) runs[0].text = runs[0].text.trimStart();
      } else if (lines[lineIndex - 1].short && !/^\p{Ll}/u.test(nextText)) {
        // A line that ends early was broken on purpose: an address, a
        // verse, a list of names. One carrying on mid-sentence just wrapped
        // in a narrow space, like a table cell.
        last.text = last.text.replace(/\s+$/, "");
        out.push(text("\n"));
      } else if (!/\s$/.test(last.text)) {
        out.push(text(" "));
      }
    }

    for (const run of runs) {
      const value = run.text.replace(/\s+/g, " ");
      if (!value) continue;
      const marks: Marks = {};
      if (run.bold && !options.headingText) marks.bold = true;
      if (run.italic) marks.italic = true;
      if (run.mono) marks.code = true;
      if (run.superscript) marks.superscript = true;
      if (run.subscript) marks.subscript = true;
      if (run.color && !run.href) marks.color = run.color;
      const node = text(value, marks);
      const previous = out[out.length - 1];
      if (run.href) {
        if (previous && previous.type === "a" && previous.url === run.href) previous.children!.push(node);
        else out.push(link(run.href, [node]));
      } else {
        out.push(node);
      }
    }
  });

  if (out.length) {
    const first = out[0];
    if (typeof first.text === "string") first.text = first.text.trimStart();
    const last = out[out.length - 1];
    if (typeof last.text === "string") last.text = last.text.trimEnd();
  }
  return out;
}
