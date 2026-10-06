/**
 * The export model: one reading of a shard that the HTML, PDF and Word
 * renderers all draw from, so the three files agree on what a shard says.
 * `build.ts` makes it from the editor's Plate value.
 */

export type ExportFormat = "html" | "pdf" | "docx";

export interface TextMarks {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  subscript?: boolean;
  superscript?: boolean;
  kbd?: boolean;
  highlight?: boolean;
  /** CSS colors, normalized to `#rrggbb`. */
  color?: string;
  backgroundColor?: string;
}

export type Inline =
  | { type: "text"; text: string; marks: TextMarks }
  | { type: "link"; url: string; children: Inline[] }
  /** A link to another shard. Exports show its name; the shard isn't there. */
  | { type: "mention"; label: string }
  | { type: "date"; text: string }
  | { type: "math"; tex: string }
  | { type: "break" };

export type Align = "left" | "center" | "right" | "justify";

export type ListKind = "bullet" | "ordered" | "todo";

export type OrderedStyle =
  | "decimal"
  | "lower-alpha"
  | "upper-alpha"
  | "lower-roman"
  | "upper-roman";

export interface ListItem {
  content: Inline[];
  /** Number shown for ordered items. */
  number: number;
  checked?: boolean;
  /** Paragraphs and lists nested under the item. */
  children: Block[];
}

export interface TableCell {
  header: boolean;
  colSpan: number;
  rowSpan: number;
  blocks: Block[];
  background?: string;
}

export interface CodeToken {
  text: string;
  /** highlight.js scope, such as `keyword` or `title.function_`. */
  scope?: string;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; content: Inline[]; align?: Align }
  | { type: "paragraph"; content: Inline[]; align?: Align; indent?: number }
  /** An empty line the writer left on purpose. */
  | { type: "spacer" }
  | { type: "list"; kind: ListKind; style: OrderedStyle | "disc" | "circle" | "square"; start: number; items: ListItem[] }
  | { type: "quote"; children: Block[] }
  | { type: "callout"; icon: string; children: Block[] }
  | { type: "toggle"; summary: Inline[]; children: Block[] }
  | { type: "code"; languageLabel: string; lines: CodeToken[][] }
  | { type: "math"; tex: string }
  | { type: "image"; assetId: string | null; source: string; alt: string; caption: Inline[]; width?: number; align?: Align }
  | { type: "media"; kind: "video" | "audio" | "file" | "embed"; url: string; name: string; isRemote: boolean }
  | { type: "table"; rows: TableCell[][]; columnWidths: number[] | null }
  | { type: "columns"; widths: number[]; columns: Block[][] }
  | { type: "rule" }
  | { type: "toc"; entries: TocEntry[] };

export interface TocEntry {
  level: number;
  id: string;
  text: string;
}

export interface ExportImageRequest {
  id: string;
  source: string;
}

export interface ExportDocument {
  title: string;
  blocks: Block[];
  /** Images to load before rendering, by `assetId`. */
  images: ExportImageRequest[];
  hasMath: boolean;
}
