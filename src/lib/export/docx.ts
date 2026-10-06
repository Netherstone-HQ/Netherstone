/**
 * Word export. Builds the document with real Word structure, so it keeps
 * working after export: heading styles (navigation pane, Word's own table of
 * contents), numbered lists, checkboxes you can tick, editable equations and
 * repeating table headers. Fonts are named, not embedded, with stand-ins
 * for computers that don't have them (see `addFontFallbacks`).
 */

import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  CheckBox,
  Document,
  ExternalHyperlink,
  Footer,
  ImageRun,
  ImportedXmlComponent,
  InternalHyperlink,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ParagraphChild,
} from "docx";
import JSZip from "jszip";
import katex from "katex";
import { mml2omml } from "mathml2omml";

import type { AssetIO, ImageMap, LoadedImage } from "./assets";
import type { Block, ExportDocument, Inline, ListItem, TableCell as ModelCell, TextMarks } from "./model";
import type { ExportOptions } from "./options";
import { PALETTE, WORD_FONTS, pageGeometry, printType, type PrintType } from "./theme";

export interface DocxRenderOptions {
  images: ImageMap;
  options: ExportOptions;
  /** Converts images Word can't show (WebP, AVIF, SVG) to PNG. */
  toPng: AssetIO["toPng"];
  lang?: string;
}

type DocxChild = Paragraph | Table;

const TWIPS_PER_MM = 1440 / 25.4;
const TWIPS_PER_PX = 15;
const halfPoints = (points: number) => Math.round(points * 2);
const twips = (points: number) => Math.round(points * 20);
const hex = (color: string) => color.replace("#", "").toUpperCase();

const HEADING_STYLE_IDS = ["Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"] as const;

const NO_BORDER = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } as const;
const NO_BORDERS = { top: NO_BORDER, bottom: NO_BORDER, left: NO_BORDER, right: NO_BORDER, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER };

const LIST_INDENT = 360;
const LIST_HANGING = 280;

const WORD_IMAGE_TYPES: Partial<Record<LoadedImage["mime"], "png" | "jpg" | "gif" | "bmp">> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

// ── Math ────────────────────────────────────────────────────────────────────

const MATH_ALPHABETS: Record<string, { upper: number; lower: number; digit?: number; exceptions?: Record<string, string> }> = {
  bold: { upper: 0x1d400, lower: 0x1d41a, digit: 0x1d7ce },
  "bold-italic": { upper: 0x1d468, lower: 0x1d482 },
  "double-struck": {
    upper: 0x1d538,
    lower: 0x1d552,
    digit: 0x1d7d8,
    exceptions: { C: "ℂ", H: "ℍ", N: "ℕ", P: "ℙ", Q: "ℚ", R: "ℝ", Z: "ℤ" },
  },
  fraktur: { upper: 0x1d504, lower: 0x1d51e, exceptions: { C: "ℭ", H: "ℌ", I: "ℑ", R: "ℜ", Z: "ℨ" } },
  script: {
    upper: 0x1d49c,
    lower: 0x1d4b6,
    exceptions: { B: "ℬ", E: "ℰ", F: "ℱ", H: "ℋ", I: "ℐ", L: "ℒ", M: "ℳ", R: "ℛ", e: "ℯ", g: "ℊ", o: "ℴ" },
  },
  "sans-serif": { upper: 0x1d5a0, lower: 0x1d5ba, digit: 0x1d7e2 },
  monospace: { upper: 0x1d670, lower: 0x1d68a, digit: 0x1d7f6 },
};

/**
 * Letters KaTeX marks as `\mathbb`, `\mathcal` and friends become the matching
 * Unicode math letters (ℝ, 𝒞), which Word's equations show as intended.
 */
function styleMathLetters(mathml: string) {
  return mathml.replace(
    /<(mi|mn|mtext)([^>]*?)\smathvariant="([^"]+)"([^>]*)>([^<]*)<\/\1>/g,
    (whole, tag: string, before: string, variant: string, after: string, content: string) => {
      const alphabet = MATH_ALPHABETS[variant === "bold-script" ? "script" : variant];
      if (!alphabet) return variant === "normal" ? whole : `<${tag}${before}${after}>${content}</${tag}>`;
      const styled = [...content]
        .map((character) => {
          if (alphabet.exceptions?.[character]) return alphabet.exceptions[character];
          const code = character.codePointAt(0)!;
          if (code >= 65 && code <= 90) return String.fromCodePoint(alphabet.upper + code - 65);
          if (code >= 97 && code <= 122) return String.fromCodePoint(alphabet.lower + code - 97);
          if (alphabet.digit && code >= 48 && code <= 57) return String.fromCodePoint(alphabet.digit + code - 48);
          return character;
        })
        .join("");
      return `<${tag}${before}${after}>${styled}</${tag}>`;
    },
  );
}

/**
 * One XML element for the document. `fromXmlString` parses into a nameless
 * document node, which would be written out as `<undefined>`; the element
 * is its only child.
 */
function importXml(xml: string): ImportedXmlComponent {
  const parsed = ImportedXmlComponent.fromXmlString(xml) as unknown as { root: unknown[] };
  const element = parsed.root.find((child) => child instanceof ImportedXmlComponent);
  if (!element) throw new Error("Imported XML has no element.");
  return element as ImportedXmlComponent;
}

/** LaTeX to an Office Math (OMML) `m:oMath` element, or null. */
export function latexToOmml(tex: string): string | null {
  try {
    const html = katex.renderToString(tex, { output: "mathml", throwOnError: true, strict: "ignore" });
    const math = /<math[\s\S]*<\/math>/.exec(html)?.[0];
    if (!math) return null;
    const cleaned = styleMathLetters(
      math
        .replace(/<annotation[\s\S]*?<\/annotation>/g, "")
        .replace(/<\/?semantics>/g, "")
        .replace(/<mpadded[^>]*>/g, "<mrow>")
        .replace(/<\/mpadded>/g, "</mrow>"),
    );
    return mml2omml(cleaned).replace(/<m:sty m:val="undefined"\/>/g, "");
  } catch {
    return null;
  }
}

// ── Writer ──────────────────────────────────────────────────────────────────

interface Context {
  /** Width available to content, in twips. */
  width: number;
  /** List depth of the current content, for continuation indents. */
  listLevel: number;
  /** Paragraph style for everything inside, such as "Quote". */
  style?: string;
}

class DocxWriter {
  private readonly numberingConfigs = new Map<string, { reference: string; levels: object[] }>();
  private numberingInstance = 0;

  private readonly fonts: WordFonts;
  private readonly type: PrintType;
  /** Fixed sizes (labels, cards) follow the chosen text size. */
  private readonly scale: number;

  constructor(
    options: ExportOptions,
    private readonly images: Map<string, LoadedImage | null>,
  ) {
    this.fonts = wordFonts(options);
    this.type = printType(options.textSize);
    this.scale = this.type.body / 11;
  }

  get numbering() {
    return [...this.numberingConfigs.values()];
  }

  // ── Inline content ────────────────────────────────────────────────────────

  private runOptions(marks: TextMarks): IRunOptions {
    const { fonts } = this;
    const options: Record<string, unknown> = {};
    if (marks.bold) options.bold = true;
    if (marks.italic) options.italics = true;
    if (marks.underline) options.underline = { color: hex(PALETTE.ink) };
    if (marks.strikethrough) options.strike = true;
    if (marks.subscript) options.subScript = true;
    if (marks.superscript) options.superScript = true;
    if (marks.color) options.color = hex(marks.color);

    if (marks.code || marks.kbd) {
      options.font = fonts.mono;
      options.size = halfPoints(this.type.body * 0.84);
      options.shading = { type: ShadingType.CLEAR, color: "auto", fill: hex(marks.kbd ? PALETTE.codeSurface : PALETTE.surface) };
      if (marks.kbd) options.border = { style: BorderStyle.SINGLE, size: 4, color: hex(PALETTE.kbdBorder), space: 0 };
    }
    if (marks.highlight) options.shading = { type: ShadingType.CLEAR, color: "auto", fill: hex(PALETTE.highlight) };
    if (marks.backgroundColor) options.shading = { type: ShadingType.CLEAR, color: "auto", fill: hex(marks.backgroundColor) };
    return options as IRunOptions;
  }

  private chip(text: string, muted: boolean): TextRun {
    return new TextRun({
      text: ` ${text} `,
      font: this.fonts.heading,
      size: halfPoints(this.type.body * 0.82),
      color: hex(muted ? PALETTE.muted : PALETTE.ink),
      shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(PALETTE.surface) },
    });
  }

  private math(tex: string, display: boolean): ParagraphChild {
    const omml = latexToOmml(tex);
    if (!omml) {
      return new TextRun({ text: tex, font: this.fonts.mono, size: halfPoints(this.type.body * 0.84), color: hex(PALETTE.muted) });
    }
    const xml = display
      ? `<m:oMathPara xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">${omml}</m:oMathPara>`
      : omml;
    return importXml(xml) as unknown as ParagraphChild;
  }

  inlines(inlines: Inline[], base: TextMarks = {}): ParagraphChild[] {
    const children: ParagraphChild[] = [];
    for (const inline of inlines) {
      switch (inline.type) {
        case "text":
          children.push(new TextRun({ text: inline.text, ...this.runOptions({ ...base, ...inline.marks }) }));
          break;
        case "link": {
          const runs = this.inlines(inline.children, { ...base, underline: true }) as TextRun[];
          if (inline.url.startsWith("#")) {
            children.push(new InternalHyperlink({ anchor: bookmarkId(inline.url.slice(1)), children: runs }));
          } else {
            children.push(new ExternalHyperlink({ link: inline.url, children: runs }));
          }
          break;
        }
        case "mention":
          children.push(this.chip(inline.label, false));
          break;
        case "date":
          children.push(this.chip(inline.text, true));
          break;
        case "math":
          children.push(this.math(inline.tex, false));
          break;
        case "break":
          children.push(new TextRun({ break: 1 }));
          break;
      }
    }
    return children;
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  blocks(blocks: Block[], context: Context): DocxChild[] {
    return blocks.flatMap((block) => this.block(block, context));
  }

  private paragraph(options: IParagraphOptions, context: Context): Paragraph {
    const styled = context.style && !options.style ? { ...options, style: context.style } : options;
    if (context.listLevel > 0 && !styled.numbering && !styled.indent) {
      return new Paragraph({ ...styled, indent: { left: LIST_INDENT * context.listLevel + (context.style === "Quote" ? 360 : 0) } });
    }
    return new Paragraph(styled);
  }

  private alignment(align: string | undefined) {
    if (align === "center") return AlignmentType.CENTER;
    if (align === "right") return AlignmentType.RIGHT;
    if (align === "justify") return AlignmentType.JUSTIFIED;
    return undefined;
  }

  private block(block: Block, context: Context): DocxChild[] {
    switch (block.type) {
      case "heading": {
        return [
          this.paragraph(
            {
              style: HEADING_STYLE_IDS[block.level - 1],
              alignment: this.alignment(block.align),
              children: [new Bookmark({ id: bookmarkId(block.id), children: this.inlines(block.content) as TextRun[] })],
            },
            context,
          ),
        ];
      }
      case "paragraph":
        return [
          this.paragraph(
            {
              alignment: this.alignment(block.align),
              ...(block.indent ? { indent: { left: LIST_INDENT * (block.indent + context.listLevel) } } : {}),
              children: this.inlines(block.content),
            },
            context,
          ),
        ];
      case "spacer":
        return [this.paragraph({ children: [] }, context)];
      case "list":
        return this.list(block, context);
      case "quote":
        return this.blocks(block.children, { ...context, style: "Quote" });
      case "callout":
        return [this.callout(block, context)];
      case "toggle":
        return [
          this.paragraph(
            {
              keepNext: true,
              children: [
                new TextRun({ text: "▾ ", color: hex(PALETTE.muted), font: this.fonts.heading }),
                ...this.inlines(block.summary),
              ],
            },
            context,
          ),
          ...this.blocks(block.children, { ...context, listLevel: context.listLevel + 1 }),
        ];
      case "code":
        return [this.code(block, context)];
      case "math":
        return [
          this.paragraph(
            { alignment: AlignmentType.CENTER, spacing: { before: 160, after: 160 }, children: [this.math(block.tex, true)] },
            context,
          ),
        ];
      case "image":
        return this.image(block, context);
      case "media":
        return [this.media(block, context)];
      case "table":
        return [this.table(block, context), this.gap()];
      case "columns":
        return [this.columns(block, context), this.gap()];
      case "rule":
        return [
          this.paragraph(
            {
              spacing: { before: 200, after: 320 },
              border: { bottom: { style: BorderStyle.SINGLE, size: 10, color: hex(PALETTE.ruleBar), space: 1 } },
              children: [],
            },
            context,
          ),
        ];
      case "toc":
        return this.toc(block);
    }
  }

  private gap() {
    return new Paragraph({ spacing: { before: 0, after: 0, line: 120 }, children: [] });
  }

  private numberingReference(block: Extract<Block, { type: "list" }>) {
    const key = `${block.kind}-${block.style}-${block.start}`;
    if (!this.numberingConfigs.has(key)) {
      const levels = Array.from({ length: 9 }, (_, level) => {
        const indent = { left: LIST_INDENT * (level + 1) + 40, hanging: LIST_HANGING };
        if (block.kind === "bullet") {
          const glyph = { disc: "•", circle: "◦", square: "▪" }[block.style as string] ?? "•";
          return {
            level,
            format: LevelFormat.BULLET,
            text: glyph,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent }, run: { font: this.fonts.body } },
          };
        }
        const format = {
          decimal: LevelFormat.DECIMAL,
          "lower-alpha": LevelFormat.LOWER_LETTER,
          "upper-alpha": LevelFormat.UPPER_LETTER,
          "lower-roman": LevelFormat.LOWER_ROMAN,
          "upper-roman": LevelFormat.UPPER_ROMAN,
        }[block.style as string] ?? LevelFormat.DECIMAL;
        return {
          level,
          format,
          text: `%${level + 1}.`,
          start: block.start,
          alignment: AlignmentType.LEFT,
          style: { paragraph: { indent } },
        };
      });
      this.numberingConfigs.set(key, { reference: `list-${key}`, levels });
    }
    return this.numberingConfigs.get(key)!.reference;
  }

  private list(block: Extract<Block, { type: "list" }>, context: Context): DocxChild[] {
    const level = context.listLevel;
    const childContext = { ...context, listLevel: level + 1 };

    if (block.kind === "todo") {
      return block.items.flatMap((item) => [
        new Paragraph({
          indent: { left: LIST_INDENT * (level + 1) + 40, hanging: LIST_HANGING + 40 },
          children: [
            new CheckBox({
              checked: item.checked,
              checkedState: { value: "2611", font: "Segoe UI Symbol" },
              uncheckedState: { value: "2610", font: "Segoe UI Symbol" },
            }),
            new TextRun({ text: "\t" }),
            ...this.inlines(item.content, item.checked ? { strikethrough: true, color: PALETTE.muted } : {}),
          ],
          tabStops: [{ type: TabStopType.LEFT, position: LIST_INDENT * (level + 1) + 40 }],
        }),
        ...this.blocks(item.children, childContext),
      ]);
    }

    const reference = this.numberingReference(block);
    this.numberingInstance += 1;
    const instance = this.numberingInstance;
    return block.items.flatMap((item: ListItem) => [
      new Paragraph({ numbering: { reference, level, instance }, children: this.inlines(item.content) }),
      ...this.blocks(item.children, childContext),
    ]);
  }

  /** A one-cell table: Word's way to give a block a background. */
  private panel(children: DocxChild[], context: Context, fill: string, margins = { x: 200, y: 160 }): Table {
    const width = Math.max(1000, context.width - LIST_INDENT * context.listLevel);
    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: [width],
      layout: TableLayoutType.FIXED,
      indent: context.listLevel ? { size: LIST_INDENT * context.listLevel, type: WidthType.DXA } : undefined,
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          cantSplit: false,
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: "auto", fill },
              margins: { top: margins.y, bottom: margins.y, left: margins.x, right: margins.x },
              children: children.length ? children : [new Paragraph({ children: [] })],
            }),
          ],
        }),
      ],
    });
  }

  private callout(block: Extract<Block, { type: "callout" }>, context: Context): Table {
    const width = Math.max(1000, context.width - LIST_INDENT * context.listLevel);
    const iconWidth = 460;
    const inner = { width: width - iconWidth - 400, listLevel: 0 };
    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: [iconWidth, width - iconWidth],
      layout: TableLayoutType.FIXED,
      indent: context.listLevel ? { size: LIST_INDENT * context.listLevel, type: WidthType.DXA } : undefined,
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(PALETTE.surface) },
              margins: { top: 160, bottom: 160, left: 180, right: 0 },
              children: [
                new Paragraph({
                  spacing: { after: 0 },
                  children: [new TextRun({ text: block.icon, font: "Segoe UI Emoji", size: halfPoints(12.5 * this.scale) })],
                }),
              ],
            }),
            new TableCell({
              shading: { type: ShadingType.CLEAR, color: "auto", fill: hex(PALETTE.surface) },
              margins: { top: 160, bottom: 100, left: 120, right: 200 },
              children: this.blocks(block.children, inner),
            }),
          ],
        }),
      ],
    });
  }

  private code(block: Extract<Block, { type: "code" }>, context: Context): Table {
    const { fonts } = this;
    const line = Math.round(this.type.codeLineHeight * 240);
    const children: Paragraph[] = [];
    if (block.languageLabel) {
      children.push(
        new Paragraph({
          spacing: { after: 100 },
          children: [new TextRun({ text: block.languageLabel, font: fonts.heading, size: halfPoints(7.5 * this.scale), color: hex(PALETTE.muted) })],
        }),
      );
    }
    for (const tokens of block.lines) {
      children.push(
        new Paragraph({
          spacing: { before: 0, after: 0, line },
          children: tokens.length
            ? tokens.map(
                (token) =>
                  new TextRun({
                    text: token.text.replace(/\t/g, "  "),
                    font: fonts.mono,
                    size: halfPoints(this.type.code),
                    color: hex(token.color ?? PALETTE.ink),
                    bold: token.bold,
                    italics: token.italic,
                  }),
              )
            : [new TextRun({ text: "", font: fonts.mono, size: halfPoints(this.type.code) })],
        }),
      );
    }
    return this.panel(children, context, hex(PALETTE.codeSurface), { x: 240, y: 200 });
  }

  private image(block: Extract<Block, { type: "image" }>, context: Context): DocxChild[] {
    const image = block.assetId ? this.images.get(block.assetId) : null;
    const caption = block.caption.length
      ? [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 80, after: 200 },
            children: this.inlines(block.caption, { color: PALETTE.muted }),
            style: "Caption",
          }),
        ]
      : [];

    if (!image) {
      return [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
          border: {
            top: { style: BorderStyle.DASHED, size: 4, color: hex(PALETTE.rule), space: 8 },
            bottom: { style: BorderStyle.DASHED, size: 4, color: hex(PALETTE.rule), space: 8 },
            left: { style: BorderStyle.DASHED, size: 4, color: hex(PALETTE.rule), space: 8 },
            right: { style: BorderStyle.DASHED, size: 4, color: hex(PALETTE.rule), space: 8 },
          },
          children: [
            new TextRun({ text: "Image not available", font: this.fonts.heading, size: halfPoints(8.5 * this.scale), bold: true }),
            new TextRun({ text: block.source || "No source", break: 1, font: this.fonts.heading, size: halfPoints(8.5 * this.scale), color: hex(PALETTE.muted) }),
          ],
        }),
        ...caption,
      ];
    }

    const available = (context.width - LIST_INDENT * context.listLevel) / TWIPS_PER_PX;
    let width = Math.min(block.width ?? image.width, available);
    let height = (width * image.height) / image.width;
    const maxHeight = (520 * 4) / 3;
    if (height > maxHeight) {
      width = (maxHeight * image.width) / image.height;
      height = maxHeight;
    }
    const type = WORD_IMAGE_TYPES[image.mime] ?? "png";
    const alignment = block.align === "left" ? AlignmentType.LEFT : block.align === "right" ? AlignmentType.RIGHT : AlignmentType.CENTER;

    return [
      new Paragraph({
        alignment,
        keepNext: caption.length > 0,
        spacing: { before: 160, after: caption.length ? 0 : 160 },
        children: [
          new ImageRun({
            type,
            data: image.bytes,
            transformation: { width: Math.round(width), height: Math.round(height) },
            altText: { name: block.alt || "Image", description: block.alt, title: block.alt },
          }),
        ],
      }),
      ...caption,
    ];
  }

  private media(block: Extract<Block, { type: "media" }>, context: Context): Table {
    const { fonts } = this;
    const labels = { video: "Video", audio: "Audio", file: "File", embed: "Embedded page" } as const;
    const name = new TextRun({ text: block.name, font: fonts.heading, size: halfPoints(9.5 * this.scale), color: hex(PALETTE.ink) });
    const meta = new TextRun({
      text: block.isRemote ? `${labels[block.kind]} · ${block.url}` : labels[block.kind],
      font: fonts.heading,
      size: halfPoints(8 * this.scale),
      color: hex(PALETTE.muted),
    });
    const width = Math.max(1000, context.width - LIST_INDENT * context.listLevel);
    const border = { style: BorderStyle.SINGLE, size: 6, color: hex(PALETTE.rule) };
    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: [width],
      layout: TableLayoutType.FIXED,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: NO_BORDER, insideVertical: NO_BORDER },
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              margins: { top: 140, bottom: 140, left: 200, right: 200 },
              children: [
                new Paragraph({
                  spacing: { after: 40 },
                  children: block.isRemote ? [new ExternalHyperlink({ link: block.url, children: [name] })] : [name],
                }),
                new Paragraph({ spacing: { after: 0 }, children: [meta] }),
              ],
            }),
          ],
        }),
      ],
    });
  }

  private table(block: Extract<Block, { type: "table" }>, context: Context): Table {
    const width = Math.max(1000, context.width - LIST_INDENT * context.listLevel);
    const columnCount = Math.max(1, ...block.rows.map((row) => row.reduce((sum, cell) => sum + cell.colSpan, 0)));
    const total = block.columnWidths?.reduce((sum, value) => sum + value, 0) ?? 0;
    const columnWidths =
      block.columnWidths && block.columnWidths.length === columnCount && total
        ? block.columnWidths.map((value) => Math.round((value / total) * width))
        : Array.from({ length: columnCount }, () => Math.round(width / columnCount));
    const border = { style: BorderStyle.SINGLE, size: 5, color: hex(PALETTE.rule) };

    let headerRows = 0;
    while (headerRows < block.rows.length && block.rows[headerRows].every((cell) => cell.header)) headerRows += 1;

    const cell = (model: ModelCell, columnIndex: number) => {
      const cellWidth = columnWidths.slice(columnIndex, columnIndex + model.colSpan).reduce((sum, value) => sum + value, 0);
      const content = this.blocks(model.blocks, { width: cellWidth - 280, listLevel: 0, style: model.header ? "TableHeader" : undefined });
      return new TableCell({
        columnSpan: model.colSpan > 1 ? model.colSpan : undefined,
        rowSpan: model.rowSpan > 1 ? model.rowSpan : undefined,
        width: { size: cellWidth, type: WidthType.DXA },
        verticalAlign: VerticalAlignTable.TOP,
        shading:
          model.background || model.header
            ? { type: ShadingType.CLEAR, color: "auto", fill: hex(model.background ?? PALETTE.tableHeader) }
            : undefined,
        margins: { top: 100, bottom: 60, left: 140, right: 140 },
        children: content.length ? content : [new Paragraph({ children: [] })],
      });
    };

    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths,
      layout: TableLayoutType.FIXED,
      indent: context.listLevel ? { size: LIST_INDENT * context.listLevel, type: WidthType.DXA } : undefined,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      style: "ShardTable",
      rows: block.rows.map((row, rowIndex) => {
        let columnIndex = 0;
        return new TableRow({
          tableHeader: rowIndex < headerRows,
          cantSplit: true,
          children: row.map((model) => {
            const built = cell(model, columnIndex);
            columnIndex += model.colSpan;
            return built;
          }),
        });
      }),
    });
  }

  private columns(block: Extract<Block, { type: "columns" }>, context: Context): Table {
    const width = Math.max(1000, context.width - LIST_INDENT * context.listLevel);
    const gutter = 360;
    const columnWidths = block.widths.map((share) => Math.round(share * width));
    return new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths,
      layout: TableLayoutType.FIXED,
      borders: NO_BORDERS,
      rows: [
        new TableRow({
          children: block.columns.map(
            (column, index) =>
              new TableCell({
                width: { size: columnWidths[index], type: WidthType.DXA },
                margins: {
                  top: 0,
                  bottom: 0,
                  left: index === 0 ? 0 : gutter / 2,
                  right: index === block.columns.length - 1 ? 0 : gutter / 2,
                },
                children: (() => {
                  const content = this.blocks(column, { width: columnWidths[index] - gutter, listLevel: 0 });
                  return content.length ? content : [new Paragraph({ children: [] })];
                })(),
              }),
          ),
        }),
      ],
    });
  }

  private toc(block: Extract<Block, { type: "toc" }>): Paragraph[] {
    if (!block.entries.length) return [];
    const minLevel = Math.min(...block.entries.map((entry) => entry.level));
    return block.entries.map(
      (entry, index) =>
        new Paragraph({
          indent: { left: (entry.level - minLevel) * 300 },
          spacing: { before: index === 0 ? 120 : 0, after: index === block.entries.length - 1 ? 240 : 40 },
          children: [
            new InternalHyperlink({
              anchor: bookmarkId(entry.id),
              children: [
                new TextRun({ text: entry.text, font: this.fonts.heading, size: halfPoints(this.type.body * 0.92), color: hex(PALETTE.muted) }),
              ],
            }),
          ],
        }),
    );
  }
}

/** Word bookmark names: letters first, at most 40 characters. */
function bookmarkId(id: string) {
  return `h_${id.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 40);
}

// ── Document ────────────────────────────────────────────────────────────────

interface WordFonts {
  body: string;
  heading: string;
  mono: string;
}

function wordFonts(options: ExportOptions): WordFonts {
  return {
    body: WORD_FONTS[options.typeface].name,
    heading: WORD_FONTS.geist.name,
    mono: WORD_FONTS.mono.name,
  };
}

function documentStyles(fonts: WordFonts, type: PrintType, lang: string) {
  const ink = hex(PALETTE.ink);
  const paragraphStyles = HEADING_STYLE_IDS.map((id, index) => {
    const level = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6;
    const style = type.headings[level];
    return {
      id,
      name: `Heading ${level}`,
      basedOn: "Normal",
      next: "Normal",
      quickFormat: true,
      run: { font: fonts.heading, bold: true, size: halfPoints(style.size), color: ink },
      paragraph: {
        keepNext: true,
        keepLines: true,
        outlineLevel: index,
        spacing: { before: twips(style.before), after: twips(style.after), line: 300 },
      },
    };
  });

  return {
    default: {
      document: {
        run: { font: fonts.body, size: halfPoints(type.body), color: ink, language: { value: lang } },
        paragraph: { spacing: { after: twips(type.paragraphGap), line: Math.round(type.lineHeight * 240) } },
      },
      hyperlink: { run: { color: ink, underline: { color: ink } } },
    },
    paragraphStyles: [
      ...paragraphStyles,
      {
        id: "Quote",
        name: "Quote",
        basedOn: "Normal",
        next: "Normal",
        quickFormat: true,
        run: { italics: true },
        paragraph: {
          indent: { left: 360 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: hex(PALETTE.rule), space: 12 } },
        },
      },
      {
        id: "TableHeader",
        name: "Table Header",
        basedOn: "Normal",
        run: { font: fonts.heading, bold: true, size: halfPoints(type.body * 0.9) },
        paragraph: { spacing: { after: 0 } },
      },
      {
        id: "Caption",
        name: "Caption",
        basedOn: "Normal",
        next: "Normal",
        run: { size: halfPoints(type.small), color: hex(PALETTE.muted) },
        paragraph: { alignment: AlignmentType.CENTER },
      },
      {
        id: "Footer",
        name: "footer",
        basedOn: "Normal",
        run: { font: fonts.heading, size: halfPoints(type.footer), color: hex(PALETTE.muted) },
        paragraph: { spacing: { after: 0 } },
      },
    ],
  };
}

/**
 * Word substitutes fonts that aren't installed. The font table tells it what
 * kind each one is and a close stand-in, so Newsreader falls back to a serif
 * and Geist to a sans, not to Word's default.
 */
async function addFontFallbacks(docx: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(docx);
  const table = await zip.file("word/fontTable.xml")?.async("string");
  if (!table) return docx;

  const entries = Object.values(WORD_FONTS)
    .filter((font) => !table.includes(`w:name="${font.name}"`))
    .map(
      (font) =>
        `<w:font w:name="${font.name}"><w:altName w:val="${font.fallback}"/><w:charset w:val="00"/><w:family w:val="${font.kind}"/><w:pitch w:val="${font.kind === "modern" ? "fixed" : "variable"}"/></w:font>`,
    )
    .join("");
  // The table may be empty and written as a self-closing `<w:fonts .../>`.
  const updated = table.includes("</w:fonts>")
    ? table.replace("</w:fonts>", `${entries}</w:fonts>`)
    : table.replace(/<w:fonts\b([^>]*?)\s*\/>/, `<w:fonts$1>${entries}</w:fonts>`);
  zip.file("word/fontTable.xml", updated);

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

/** Converts images Word can't show to PNG, measured in the same pixels. */
async function wordImages(images: ImageMap, toPng: AssetIO["toPng"]) {
  const result = new Map<string, LoadedImage | null>();
  await Promise.all(
    [...images].map(async ([id, image]) => {
      if (WORD_IMAGE_TYPES[image.mime]) {
        result.set(id, image);
      } else {
        // Vector art is drawn at twice its size so it stays sharp.
        const converted = await toPng(image, image.mime === "image/svg+xml" ? 2 : 1);
        result.set(id, converted);
      }
    }),
  );
  return result;
}

export async function renderDocx(doc: ExportDocument, options: DocxRenderOptions): Promise<Uint8Array> {
  const geometry = pageGeometry(options.options.pageSize, options.options.margins);
  const twipsOf = (millimetres: number) => Math.round(millimetres * TWIPS_PER_MM);
  const pageWidth = twipsOf(geometry.widthMm);
  const contentWidth = pageWidth - twipsOf(geometry.marginLeftMm) - twipsOf(geometry.marginRightMm);
  const type = printType(options.options.textSize);
  const fonts = wordFonts(options.options);

  const images = await wordImages(options.images, options.toPng);
  const writer = new DocxWriter(options.options, images);
  const body = writer.blocks(doc.blocks, { width: contentWidth, listLevel: 0 });

  const footer = new Footer({
    children: [
      new Paragraph({
        style: "Footer",
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
        children: [
          new TextRun({ text: doc.title }),
          new TextRun({ children: ["\t", PageNumber.CURRENT, " / ", PageNumber.TOTAL_PAGES] }),
        ],
      }),
    ],
  });

  const document = new Document({
    creator: "Netherstone",
    title: doc.title,
    styles: documentStyles(fonts, type, options.lang ?? "en-US"),
    numbering: { config: writer.numbering as never },
    features: {},
    sections: [
      {
        properties: {
          page: {
            size: { width: pageWidth, height: twipsOf(geometry.heightMm) },
            margin: {
              top: twipsOf(geometry.marginTopMm),
              bottom: twipsOf(geometry.marginBottomMm),
              left: twipsOf(geometry.marginLeftMm),
              right: twipsOf(geometry.marginRightMm),
              footer: twipsOf(geometry.marginBottomMm * 0.45),
            },
          },
        },
        footers: options.options.pageNumbers ? { default: footer } : undefined,
        children: body.length ? body : [new Paragraph({ children: [] })],
      },
    ],
  });

  return addFontFallbacks(new Uint8Array(await Packer.toArrayBuffer(document)));
}
