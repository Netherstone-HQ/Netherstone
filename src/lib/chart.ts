import { NodeApi, type TElement } from "platejs";

import {
  createRawBlockNode,
  type TRawBlockElement,
} from "./markdown-raw-blocks";

/**
 * A chart is drawn from the table right above it. In a file it is a hidden
 * comment under that table, so other Markdown apps show the table alone:
 *
 *     | Week | km | Runs |
 *     | ---- | -- | ---- |
 *     | ...  |    |      |
 *
 *     <!-- netherstone chart: bar; x Week; y km, Runs; title km by week -->
 *
 * `x` names the column along the bottom, `y` the columns with the numbers,
 * by their headers. The editor loads the comment as a raw block like any
 * other and draws it as a chart, so saving needs nothing of its own.
 */

export type ChartKind = "bar" | "line";

export interface ChartSpec {
  kind: ChartKind;
  /** The header of the column along the bottom, or null for the first. */
  x: string | null;
  /** The headers of the columns drawn; empty draws the first numeric one. */
  y: string[];
  title: string;
}

/** Columns a chart draws at most: more are hard to tell apart. */
export const MAX_SERIES = 3;

const CHART_COMMENT = /^<!--\s*netherstone chart:\s*([\s\S]*?)\s*-->$/;

export function isChartComment(value: string) {
  return CHART_COMMENT.test(value.trim());
}

/** The chart a comment describes, or null if it isn't one. */
export function parseChartComment(value: string): ChartSpec | null {
  const match = CHART_COMMENT.exec(value.trim());
  if (!match) return null;

  const spec: ChartSpec = { kind: "bar", x: null, y: [], title: "" };
  for (const part of match[1].split(";")) {
    const item = part.trim();
    if (item === "bar" || item === "line") {
      spec.kind = item;
      continue;
    }
    const [, key, rest = ""] = /^(\w+)\s*(.*)$/.exec(item) ?? [];
    const text = rest.trim();
    if (key === "x" && text) spec.x = text;
    else if (key === "y" && text) {
      spec.y = text
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .slice(0, MAX_SERIES);
    } else if (key === "title") spec.title = text;
  }
  return spec;
}

/** Names can't hold the comment's separators or end it early. */
function clean(text: string) {
  return text
    .replace(/[;,]|--!?>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function serializeChartComment(spec: ChartSpec) {
  const parts: string[] = [spec.kind];
  if (spec.x) parts.push(`x ${clean(spec.x)}`);
  const y = spec.y.map(clean).filter(Boolean);
  if (y.length > 0) parts.push(`y ${y.join(", ")}`);
  const title = clean(spec.title);
  if (title) parts.push(`title ${title}`);
  return `<!-- netherstone chart: ${parts.join("; ")} -->`;
}

export function createChartNode(spec: ChartSpec): TRawBlockElement {
  return createRawBlockNode(serializeChartComment(spec));
}

// ── The table's numbers ──────────────────────────────────────────────────────

export interface TableData {
  /** The first row, as the headers the chart names columns by. */
  columns: string[];
  rows: string[][];
}

export function isTableNode(node: unknown): node is TElement {
  return (
    !!node && typeof node === "object" && (node as TElement).type === "table"
  );
}

/**
 * Headers the chart can name: an empty one is named by its place, like
 * `Column 2`, and a repeated one gets its place added, like `Cost (3)`.
 */
export function columnNames(headers: string[]) {
  const names = headers.map((header, index) => header || `Column ${index + 1}`);
  return names.map((name, index) =>
    names.indexOf(name) === index ? name : `${name} (${index + 1})`,
  );
}

/** A table's text, cell by cell. Merged cells read as their first cell. */
export function readTable(table: TElement): TableData {
  const rows = (table.children as TElement[]).map((row) =>
    ((row.children ?? []) as TElement[]).map((cell) =>
      NodeApi.string(cell).trim(),
    ),
  );
  const [headers = [], ...body] = rows;
  return { columns: columnNames(headers), rows: body };
}

/** Words before a number that leave it the same number, like `about 5`. */
const ROUGHLY = String.raw`(?:about|around|approx\.?|approximately|roughly|nearly|almost|over|under|up to|at least|at most|~|≈|<|>|≤|≥)\s*`;
const AMOUNT = String.raw`([+-]?)\s*[$€£¥₹]?\s*([\d\s,]*\.?\d+)`;
const CELL_NUMBER = new RegExp(
  String.raw`^(?:${ROUGHLY})?${AMOUNT}(?:\s*(?:[-–—]|to)\s*${AMOUNT})?\s*\D{0,8}$`,
  "i",
);
/** Cells that say there's no number, drawn as a gap. */
const NO_NUMBER = /^(?:[-–—]|n\/?a)$/i;

function amount(sign: string, digits: string) {
  return Number(sign + digits.replace(/[\s,]/g, ""));
}

/**
 * The number a cell holds, ignoring thousands separators, a currency sign,
 * a word like `about` before it and a short unit after it like `%` or
 * `tokens`. A range like `$3–$5` is its middle. Null when it holds anything
 * else, such as `Q1` or `Week 3`.
 */
export function cellNumber(text: string): number | null {
  const match = CELL_NUMBER.exec(text.trim());
  if (!match) return null;
  const low = amount(match[1], match[2]);
  const value =
    match[4] === undefined ? low : (low + amount(match[3], match[4])) / 2;
  return Number.isFinite(value) ? value : null;
}

/** Whether a cell holds a number, or says it has none. */
function isEmptyCell(text: string | undefined) {
  return !text || NO_NUMBER.test(text);
}

function isNumericColumn(data: TableData, index: number) {
  return (
    data.rows.length > 0 &&
    data.rows.some((row) => !isEmptyCell(row[index])) &&
    data.rows.every(
      (row) => isEmptyCell(row[index]) || cellNumber(row[index]) !== null,
    )
  );
}

/** The columns that hold only numbers, which a chart can draw. */
export function numericColumns(data: TableData) {
  return data.columns.filter((_, index) => isNumericColumn(data, index));
}

/**
 * A default chart for a table: its first column of words along the bottom,
 * or its first column when they all hold numbers, against the numbers.
 */
export function defaultChartSpec(data: TableData): ChartSpec {
  const numbers = numericColumns(data);
  const x =
    data.columns.find((name) => !numbers.includes(name)) ??
    data.columns[0] ??
    null;
  return {
    kind: "bar",
    x,
    y: numbers.filter((name) => name !== x).slice(0, MAX_SERIES),
    title: "",
  };
}

interface ChartSeries {
  name: string;
  values: (number | null)[];
}

export interface ChartData {
  labels: string[];
  series: ChartSeries[];
}

function columnIndex(columns: string[], name: string | null) {
  if (name === null) return -1;
  const exact = columns.indexOf(name);
  if (exact >= 0) return exact;
  const lower = name.toLowerCase();
  return columns.findIndex((column) => column.toLowerCase() === lower);
}

/**
 * What the chart draws from the table: a label per row and a series per
 * column named in `y`. Columns that aren't there, or don't hold numbers,
 * are skipped; with none left the first numeric column is drawn.
 */
export function chartData(spec: ChartSpec, data: TableData): ChartData {
  let xIndex = columnIndex(data.columns, spec.x);
  if (xIndex < 0) xIndex = 0;

  let yIndexes = spec.y
    .map((name) => columnIndex(data.columns, name))
    .filter((index) => index >= 0 && index !== xIndex)
    .filter((index) => isNumericColumn(data, index));
  if (yIndexes.length === 0) {
    const first = data.columns.findIndex(
      (_, index) => index !== xIndex && isNumericColumn(data, index),
    );
    yIndexes = first >= 0 ? [first] : [];
  }

  return {
    labels: data.rows.map((row) => row[xIndex] ?? ""),
    series: yIndexes.slice(0, MAX_SERIES).map((index) => ({
      name: data.columns[index],
      values: data.rows.map((row) => cellNumber(row[index] ?? "")),
    })),
  };
}

/** Round steps for the value axis, from 0 (or the lowest value) up. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (high === low) return [low, low + 1];

  const rough = (high - low) / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ??
    10 * power;
  const start = Math.floor(low / step) * step;
  const ticks: number[] = [];
  for (let i = 0; ; i++) {
    const value = Number((start + i * step).toPrecision(12));
    ticks.push(value);
    if (value >= high) break;
  }
  return ticks;
}
