import type JSZip from "jszip";

import { CODE_LANGUAGES } from "@/components/editor/lib/code-languages";

import {
  blockquote,
  callout,
  codeBlock,
  equation,
  heading,
  image,
  inlineEquation,
  isTextColor,
  link,
  listItem,
  paragraph,
  plainText,
  rule,
  table,
  text,
  toc,
  type Align,
  type CellInput,
  type Marks,
} from "../../nodes";
import type { ImportContext, PlateNode } from "../../types";
import { ommlToLatex } from "./math";
import { isMonospace, readParagraphProps, readRunProps, type Numbering, type RunProps, type Styles } from "./styles";
import { attr, child, children, descendant, descendants, elements, is, numberAttr, val } from "./xml";

export interface Relationship {
  target: string;
  external: boolean;
}

export interface DocxParts {
  zip: JSZip;
  /** Folder of the main document inside the package, `word/`. */
  base: string;
  styles: Styles;
  numbering: Numbering;
  relationships: Map<string, Relationship>;
  notes: Map<string, Element>;
  /** File name without extension, used to name stored pictures. */
  name: string;
}

/** An inline piece of a paragraph, or a block that breaks it (a picture). */
type Item =
  | { kind: "inline"; node: PlateNode; href?: string | null }
  | { kind: "block"; node: PlateNode };

interface Field {
  instruction: string;
  phase: "code" | "result";
  href: string | null;
  skip: boolean;
}

interface RunContext {
  href: string | null;
  isHeading: boolean;
  /** Run formatting the paragraph style gives, minus what headings set. */
  base: RunProps;
}

const HIGHLIGHTS: Record<string, string> = {
  green: "#00ff00",
  cyan: "#00ffff",
  magenta: "#ff00ff",
  blue: "#0000ff",
  red: "#ff0000",
  darkBlue: "#000080",
  darkCyan: "#008080",
  darkGreen: "#008000",
  darkMagenta: "#800080",
  darkRed: "#800000",
  darkYellow: "#808000",
  darkGray: "#808080",
  lightGray: "#c0c0c0",
  black: "#000000",
  white: "#ffffff",
};

const CHECKBOX = /^\s*([☐☑☒✓✔□■])\s*/;
const CHECKED = /[☑☒✓✔■]/;
const EMU_PER_PIXEL = 9525;
const TWIPS_PER_PIXEL = 15;
const TWIPS_PER_INDENT = 720;
const UNSUPPORTED_PICTURES = new Set(["emf", "wmf", "emz", "wmz"]);

const LANGUAGE_BY_LABEL = new Map(CODE_LANGUAGES.map((language) => [language.label.toLowerCase(), language.value]));

export class DocxReader {
  private readonly fields: Field[] = [];
  private readonly pictures = new Map<string, Promise<string | null>>();
  private readonly noteOrder: { id: string; number: number }[] = [];
  private readonly listCounters = new Map<string, number[]>();
  private tocDone = false;
  private headingOffset = 0;
  private paragraphs = 0;
  private pictureCount = 0;
  private oldPictures = 0;
  private charts = 0;
  private diagrams = 0;
  private lastCode: PlateNode | null = null;
  private lastQuote: PlateNode | null = null;

  constructor(
    private readonly parts: DocxParts,
    private readonly context: ImportContext,
  ) {}

  async read(body: Element): Promise<PlateNode[]> {
    // A document with a Title has it as its one top heading; its Heading 1s
    // sit a level under it.
    this.headingOffset = descendants(body, "w", "pStyle").some(
      (element) => this.parts.styles.paragraphStyle(attr(element, "w", "val")).kind === "title",
    )
      ? 1
      : 0;
    const out: PlateNode[] = [];
    await this.blocks(elements(body), out, false);
    await this.appendNotes(out);
    this.warnings();
    return out;
  }

  private warnings() {
    const plural = (count: number, one: string, many: string) => (count === 1 ? one : many.replace("#", String(count)));
    if (this.oldPictures) {
      this.context.warn(
        plural(this.oldPictures, "1 picture is in an old Windows format (EMF or WMF) and was left out.", "# pictures are in an old Windows format (EMF or WMF) and were left out."),
      );
    }
    if (this.charts) this.context.warn(plural(this.charts, "1 chart was left out.", "# charts were left out."));
    if (this.diagrams) this.context.warn(plural(this.diagrams, "1 SmartArt diagram was left out.", "# SmartArt diagrams were left out."));
  }

  // ── Blocks ────────────────────────────────────────────────────────────────

  private async blocks(nodes: Element[], out: PlateNode[], inCell: boolean) {
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      // A run of paragraphs that are each just a link to a heading is a
      // contents list typed out by hand (or written by Netherstone).
      if (!inCell && isContentsEntry(node)) {
        let end = index;
        while (end + 1 < nodes.length && isContentsEntry(nodes[end + 1])) end += 1;
        if (end - index >= 2) {
          this.addToc(out);
          index = end;
          continue;
        }
      }
      if (is(node, "w", "p")) {
        await this.paragraph(node, out, inCell);
      } else if (is(node, "w", "tbl")) {
        this.lastCode = this.lastQuote = null;
        await this.table(node, out, inCell);
      } else if (is(node, "w", "sdt")) {
        const gallery = val(descendant(child(node, "w", "sdtPr"), "w", "docPartObj"), "docPartGallery");
        if (gallery && /table of contents/i.test(gallery)) {
          this.addToc(out);
        } else {
          await this.blocks(elements(child(node, "w", "sdtContent")), out, inCell);
        }
      } else if (is(node, "w", "customXml") || is(node, "w", "ins") || is(node, "w", "moveTo") || is(node, "mc", "AlternateContent")) {
        await this.blocks(this.contentOf(node), out, inCell);
      }
    }
  }

  /** Children, taking the preferred choice of `mc:AlternateContent`. */
  private contentOf(node: Element): Element[] {
    if (is(node, "mc", "AlternateContent")) {
      const choice = child(node, "mc", "Choice") ?? child(node, "mc", "Fallback");
      return elements(choice);
    }
    return elements(node);
  }

  private addToc(out: PlateNode[]) {
    if (this.tocDone) return;
    this.tocDone = true;
    this.lastCode = this.lastQuote = null;
    out.push(toc());
  }

  private async paragraph(p: Element, out: PlateNode[], inCell: boolean) {
    this.paragraphs += 1;
    if (this.paragraphs % 250 === 0) await this.context.checkpoint();

    const pPr = child(p, "w", "pPr");
    const style = this.parts.styles.paragraphStyle(val(pPr, "pStyle"));
    const direct = readParagraphProps(pPr);
    const props = { ...style.paragraph, ...direct };

    if (style.kind === "toc") {
      this.addToc(out);
      return;
    }

    const isHeading = style.headingLevel !== null;
    const base: RunProps = isHeading ? {} : { ...style.run, color: undefined };
    const items = await this.inlineItems(elements(p), { href: null, isHeading, base });

    const numId = props.numId;
    const level = numId ? this.parts.numbering.level(numId, props.ilvl ?? 0) : null;
    const align = readAlign(props.align);

    // A picture or display equation splits the paragraph around it.
    let pending: Item[] = [];
    let first = true;
    const flush = () => {
      const inlines = assemble(pending);
      pending = [];
      if (!hasContent(inlines)) return;
      this.emit(out, inlines, { style, props, level, numId, align, inCell, first, direct });
      first = false;
    };
    for (const item of items) {
      if (item.kind === "block") {
        flush();
        this.lastCode = this.lastQuote = null;
        out.push(item.node);
      } else {
        pending.push(item);
      }
    }
    flush();
  }

  private emit(
    out: PlateNode[],
    inlines: PlateNode[],
    options: {
      style: ReturnType<Styles["paragraphStyle"]>;
      props: ReturnType<typeof readParagraphProps>;
      level: ReturnType<Numbering["level"]>;
      numId: string | undefined;
      align: Align | undefined;
      inCell: boolean;
      first: boolean;
      direct: ReturnType<typeof readParagraphProps>;
    },
  ) {
    const { style, props, level, numId, align, inCell, direct } = options;
    // One-level lists ("List Bullet 2") nest by indent, a quarter inch a step.
    const listIndent = direct.indentLeft ?? level?.indent ?? 0;
    const depth = level?.singleLevel ? Math.max(1, Math.round(listIndent / 360)) : (props.ilvl ?? 0) + 1;

    // Code: consecutive code paragraphs are one block.
    const allCode = inlines.every((node) => typeof node.text !== "string" || node.code === true || node.text.trim() === "");
    if (!inCell && !level && (style.kind === "code" || (allCode && inlines.some((node) => node.code)))) {
      const line = plainText(inlines).replace(/ /g, " ");
      this.lastQuote = null;
      if (this.lastCode && out[out.length - 1] === this.lastCode) {
        for (const part of line.split("\n")) this.lastCode.children!.push({ type: "code_line", children: [{ text: part }] });
      } else {
        this.lastCode = codeBlock(line.split("\n"));
        out.push(this.lastCode);
      }
      return;
    }
    this.lastCode = null;
    const spaced = trimStart(trimEnd(inlines)).map((node) => (typeof node.text === "string" ? { ...node, text: node.text.replace(/\t/g, " ") } : node));

    if (style.headingLevel !== null) {
      this.lastQuote = null;
      const level = style.kind === "title" ? 1 : style.headingLevel + this.headingOffset;
      out.push(inCell ? paragraph(spaced.map((node) => (typeof node.text === "string" ? { ...node, bold: true } : node))) : heading(level, spaced, { align }));
      return;
    }

    if (style.kind === "quote" && !inCell && !level) {
      if (this.lastQuote && out[out.length - 1] === this.lastQuote) {
        this.lastQuote.children = [...this.lastQuote.children!, text("\n"), ...spaced];
      } else {
        this.lastQuote = blockquote(spaced);
        out.push(this.lastQuote);
      }
      return;
    }
    this.lastQuote = null;

    if (level && options.first) {
      const firstText = plainText(spaced);
      const checkbox = CHECKBOX.exec(firstText);
      let type = level.type;
      let content = spaced;
      let checked: boolean | undefined;
      if (checkbox || type === "todo") {
        type = "todo";
        checked = checkbox ? CHECKED.test(checkbox[1]) : false;
        content = checkbox ? stripLeading(spaced, checkbox[0].length) : spaced;
        // Word users strike done items through; the editor does that itself.
        if (checked && content.every((node) => typeof node.text !== "string" || node.strikethrough || !node.text.trim())) {
          content = content.map(({ strikethrough: _strike, ...node }) => node);
        }
      }
      if (type) {
        const number = this.count(numId!, props.ilvl ?? 0, level.start);
        if (inCell) {
          const marker = type === "todo" ? (checked ? "☑ " : "☐ ") : /^(disc|circle|square)$/.test(type) ? "• " : `${number}. `;
          out.push(paragraph([text(marker), ...content]));
          return;
        }
        const previous = out[out.length - 1];
        const continues = previous?.listStyleType === type && previous.indent === depth;
        out.push(
          listItem(content, {
            type,
            depth,
            start: !continues && number !== 1 && type !== "todo" && !/^(disc|circle|square)$/.test(type) ? number : undefined,
            checked,
            align,
          }),
        );
        return;
      }
    }

    // A paragraph with a checkbox in front is a to-do even outside a list.
    const checkbox = CHECKBOX.exec(plainText(spaced));
    if (checkbox && !inCell) {
      const checked = CHECKED.test(checkbox[1]);
      let content = stripLeading(spaced, checkbox[0].length);
      if (checked) content = content.map(({ strikethrough: _strike, ...node }) => node);
      out.push(listItem(content, { type: "todo", depth: 1, checked }));
      return;
    }

    const indent = inCell || !props.indentLeft ? 0 : Math.round(props.indentLeft / TWIPS_PER_INDENT);
    const lineHeight = props.lineSpacing && props.lineSpacing >= 1.75 ? 2 : undefined;
    const content =
      style.kind === "subtitle" ? spaced.map((node) => (typeof node.text === "string" ? { ...node, italic: true as const } : node)) : spaced;
    out.push(paragraph(content, { align, indent, lineHeight }));
  }

  /** The number of the next item at `ilvl` of list `numId`. */
  private count(numId: string, ilvl: number, start: number) {
    const counters = this.listCounters.get(numId) ?? [];
    counters[ilvl] = counters[ilvl] === undefined ? start : counters[ilvl] + 1;
    counters.length = ilvl + 1;
    this.listCounters.set(numId, counters);
    return counters[ilvl];
  }

  private async table(tbl: Element, out: PlateNode[], inCell: boolean) {
    const rowsElements = this.rowsOf(tbl);
    const firstRowCells = rowsElements[0] ? this.cellsOf(rowsElements[0]) : [];

    // A one-cell table is a box around ordinary content.
    if (rowsElements.length === 1 && firstRowCells.length === 1) {
      const inner: PlateNode[] = [];
      await this.blocks(elements(firstRowCells[0]), inner, inCell);
      out.push(...labelCode(inner));
      return;
    }

    // An icon cell beside a text cell is a callout.
    if (rowsElements.length === 1 && firstRowCells.length === 2 && !inCell) {
      const icon = plainText((await this.cellBlocks(firstRowCells[0], true))).trim();
      if (icon && /^\p{Extended_Pictographic}[\u{fe0f}\u{200d}\p{Extended_Pictographic}]*$/u.test(icon)) {
        const inner: PlateNode[] = [];
        await this.blocks(elements(firstRowCells[1]), inner, true);
        out.push(callout(icon, inner));
        return;
      }
    }

    if (inCell) {
      // Tables can't nest in a shard; the inner one's text joins the cell.
      for (const row of rowsElements) {
        for (const cell of this.cellsOf(row)) await this.blocks(elements(cell), out, true);
      }
      return;
    }

    const widths = children(child(tbl, "w", "tblGrid"), "w", "gridCol").map(
      (column) => (numberAttr(column, "w", "w") ?? 0) / TWIPS_PER_PIXEL,
    );
    const rows: CellInput[][] = [];
    const mergeOwners = new Map<number, CellInput>();

    for (const row of rowsElements) {
      const trPr = child(row, "w", "trPr");
      const header = !!child(trPr, "w", "tblHeader") && attr(child(trPr, "w", "tblHeader"), "w", "val") !== "0";
      const cells: CellInput[] = [];
      let column = numberAttr(child(trPr, "w", "gridBefore"), "w", "val") ?? 0;
      for (let index = 0; index < column; index += 1) cells.push({ children: [] });

      for (const cell of this.cellsOf(row)) {
        const tcPr = child(cell, "w", "tcPr");
        const span = Math.max(1, numberAttr(child(tcPr, "w", "gridSpan"), "w", "val") ?? 1);
        const vMerge = child(tcPr, "w", "vMerge");
        const merge = vMerge ? (attr(vMerge, "w", "val") ?? "continue") : null;

        if (merge === "continue") {
          const owner = mergeOwners.get(column);
          if (owner) {
            owner.rowSpan = (owner.rowSpan ?? 1) + 1;
            column += span;
            continue;
          }
        }

        const fill = attr(child(tcPr, "w", "shd"), "w", "fill");
        const input: CellInput = {
          header,
          colSpan: span,
          background: fill && /^[0-9a-f]{6}$/i.test(fill) && fill.toLowerCase() !== "ffffff" ? `#${fill.toLowerCase()}` : undefined,
          children: await this.cellBlocks(cell, false),
        };
        cells.push(input);
        for (let covered = column; covered < column + span; covered += 1) {
          if (merge === "restart") mergeOwners.set(covered, input);
          else mergeOwners.delete(covered);
        }
        column += span;
      }
      if (cells.length) rows.push(cells);
    }

    if (rows.length) out.push(table(rows, widths.length ? widths : undefined));
  }

  private async cellBlocks(cell: Element, quiet: boolean) {
    const blocks: PlateNode[] = [];
    const savedCode = this.lastCode;
    await this.blocks(elements(cell), blocks, true);
    if (quiet) this.lastCode = savedCode;
    return blocks;
  }

  private rowsOf(tbl: Element): Element[] {
    const rows: Element[] = [];
    for (const node of elements(tbl)) {
      if (is(node, "w", "tr")) rows.push(node);
      else if (is(node, "w", "sdt") || is(node, "w", "customXml")) rows.push(...this.rowsOf(child(node, "w", "sdtContent") ?? node));
    }
    return rows;
  }

  private cellsOf(row: Element): Element[] {
    const cells: Element[] = [];
    for (const node of elements(row)) {
      if (is(node, "w", "tc")) cells.push(node);
      else if (is(node, "w", "sdt") || is(node, "w", "customXml")) cells.push(...this.cellsOf(child(node, "w", "sdtContent") ?? node));
    }
    return cells;
  }

  // ── Inline content ────────────────────────────────────────────────────────

  private async inlineItems(nodes: Element[], context: RunContext): Promise<Item[]> {
    const items: Item[] = [];
    for (const node of nodes) await this.inline(node, context, items);
    return items;
  }

  private get fieldHref(): string | null {
    for (let index = this.fields.length - 1; index >= 0; index -= 1) {
      if (this.fields[index].href) return this.fields[index].href;
    }
    return null;
  }

  private get skipping() {
    return this.fields.some((field) => field.skip || field.phase === "code");
  }

  private async inline(node: Element, context: RunContext, items: Item[]) {
    if (is(node, "w", "r")) {
      await this.run(node, context, items);
      return;
    }
    if (is(node, "w", "hyperlink")) {
      const id = attr(node, "r", "id");
      const relationship = id ? this.parts.relationships.get(id) : undefined;
      const href = relationship ? this.linkTarget(relationship.target) : null;
      for (const inner of elements(node)) await this.inline(inner, { ...context, href: href ?? context.href }, items);
      return;
    }
    if (is(node, "w", "fldSimple")) {
      const instruction = attr(node, "w", "instr") ?? "";
      const field = this.parseField(instruction);
      if (field.toc) return;
      for (const inner of elements(node)) await this.inline(inner, { ...context, href: field.href ?? context.href }, items);
      return;
    }
    if (is(node, "m", "oMathPara")) {
      for (const math of children(node, "m", "oMath")) {
        const tex = ommlToLatex(math);
        if (tex) items.push({ kind: "block", node: equation(tex) });
      }
      return;
    }
    if (is(node, "m", "oMath")) {
      const tex = ommlToLatex(node);
      if (tex) items.push({ kind: "inline", node: inlineEquation(tex), href: null });
      return;
    }
    if (is(node, "w", "sdt")) {
      const checkbox = descendant(child(node, "w", "sdtPr"), "w14", "checkbox");
      if (checkbox) {
        const checked = attr(child(checkbox, "w14", "checked"), "w14", "val");
        items.push({ kind: "inline", node: text(checked === "1" || checked === "true" ? "☒ " : "☐ ") });
        return;
      }
      for (const inner of elements(child(node, "w", "sdtContent"))) await this.inline(inner, context, items);
      return;
    }
    if (
      is(node, "w", "smartTag") ||
      is(node, "w", "customXml") ||
      is(node, "w", "ins") ||
      is(node, "w", "moveTo") ||
      is(node, "w", "dir") ||
      is(node, "w", "bdo") ||
      is(node, "mc", "AlternateContent")
    ) {
      for (const inner of this.contentOf(node)) await this.inline(inner, context, items);
    }
  }

  private parseField(instruction: string): { href: string | null; toc: boolean } {
    const trimmed = instruction.trim();
    if (/^TOC\b/i.test(trimmed)) return { href: null, toc: true };
    const hyperlink = /^HYPERLINK\s+(?:\\[a-z]\s+)*"([^"]+)"/i.exec(trimmed);
    if (hyperlink && !/\\l\s/.test(trimmed.slice(0, trimmed.indexOf('"')))) {
      return { href: this.linkTarget(hyperlink[1]), toc: false };
    }
    return { href: null, toc: false };
  }

  private linkTarget(target: string): string | null {
    const trimmed = target.trim();
    if (/^(https?|mailto|tel):/i.test(trimmed)) return trimmed;
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith("#")) return null;
    return this.context.linkTo(trimmed.split("#")[0]);
  }

  private async run(run: Element, context: RunContext, items: Item[]) {
    const rPr = child(run, "w", "rPr");
    const styleId = val(rPr, "rStyle");
    const props: RunProps = {
      ...context.base,
      ...this.parts.styles.characterRun(styleId),
      ...readRunProps(rPr),
    };
    if (props.hidden) return;
    for (const node of elements(run)) await this.runChild(node, props, styleId, context, items);
  }

  private async runChild(node: Element, props: RunProps, styleId: string | null, context: RunContext, items: Item[]) {
    if (is(node, "w", "fldChar")) {
      const type = attr(node, "w", "fldCharType");
      if (type === "begin") {
        this.fields.push({ instruction: "", phase: "code", href: null, skip: false });
      } else if (type === "separate") {
        const field = this.fields[this.fields.length - 1];
        if (field) {
          const parsed = this.parseField(field.instruction);
          field.phase = "result";
          field.href = parsed.href;
          field.skip = parsed.toc || /^\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/i.test(field.instruction);
          if (parsed.toc) {
            const out: PlateNode[] = [];
            this.addToc(out);
            for (const block of out) items.push({ kind: "block", node: block });
          }
        }
      } else if (type === "end") {
        this.fields.pop();
      }
      return;
    }
    if (is(node, "w", "instrText")) {
      const field = this.fields[this.fields.length - 1];
      if (field && field.phase === "code") field.instruction += node.textContent ?? "";
      return;
    }
    if (this.skipping) return;

    const href = context.href ?? this.fieldHref;
    const inLink = !!href || /hyperlink/i.test(styleId ?? "");
    const pushText = (value: string) => {
      if (!value) return;
      items.push({ kind: "inline", node: text(props.caps ? value.toUpperCase() : value, this.marks(props, context.isHeading, inLink)), href });
    };

    if (is(node, "w", "t")) pushText(node.textContent ?? "");
    else if (is(node, "w", "tab") || is(node, "w", "ptab")) pushText("\t");
    else if (is(node, "w", "br")) {
      const type = attr(node, "w", "type");
      if (type !== "page" && type !== "column") pushText("\n");
    } else if (is(node, "w", "cr")) pushText("\n");
    else if (is(node, "w", "noBreakHyphen")) pushText("-");
    else if (is(node, "w", "sym")) {
      const font = attr(node, "w", "font") ?? "";
      const code = parseInt(attr(node, "w", "char") ?? "", 16);
      if (Number.isFinite(code) && !/symbol|wingdings|webdings/i.test(font)) pushText(String.fromCodePoint(code));
    } else if (is(node, "w", "footnoteReference") || is(node, "w", "endnoteReference")) {
      const id = attr(node, "w", "id");
      const prefix = is(node, "w", "endnoteReference") ? "endnote" : "footnote";
      if (id) {
        const number = this.noteOrder.length + 1;
        this.noteOrder.push({ id: `${prefix}:${id}`, number });
        items.push({ kind: "inline", node: text(String(number), { superscript: true }), href: null });
      }
    } else if (is(node, "w", "drawing")) {
      await this.drawing(node, items);
    } else if (is(node, "w", "pict") || is(node, "w", "object")) {
      await this.vml(node, items);
    } else if (is(node, "mc", "AlternateContent")) {
      for (const choice of this.contentOf(node)) await this.runChild(choice, props, styleId, context, items);
    }
  }

  private marks(props: RunProps, isHeading: boolean, inLink: boolean): Marks {
    const marks: Marks = {};
    if (isMonospace(props.font)) {
      marks.code = true;
      if (props.bold && !isHeading) marks.bold = true;
      return marks;
    }
    if (props.bold && !isHeading) marks.bold = true;
    if (props.italic) marks.italic = true;
    if (props.underline && !inLink) marks.underline = true;
    if (props.strike) marks.strikethrough = true;
    if (props.vertAlign === "superscript") marks.superscript = true;
    if (props.vertAlign === "subscript") marks.subscript = true;
    if (!inLink && props.color && props.color !== "auto" && !isTextColor(props.color)) marks.color = props.color;
    if (props.highlight && props.highlight !== "none") {
      if (props.highlight === "yellow") marks.highlight = true;
      else if (HIGHLIGHTS[props.highlight]) marks.backgroundColor = HIGHLIGHTS[props.highlight];
    } else if (props.shading && props.shading !== "auto" && props.shading !== "#ffffff") {
      marks.backgroundColor = props.shading;
    }
    const body = this.parts.styles.bodySize;
    if (!isHeading && props.size && Math.abs(props.size - body) >= 3) {
      marks.fontSize = `${Math.round(((props.size / 2) * 4) / 3)}px`;
    }
    return marks;
  }

  // ── Pictures ──────────────────────────────────────────────────────────────

  private async drawing(drawing: Element, items: Item[]) {
    const frame = child(drawing, "wp", "inline") ?? child(drawing, "wp", "anchor");
    if (!frame) return;

    const graphicData = descendant(frame, "a", "graphicData");
    const uri = graphicData?.getAttribute("uri") ?? "";
    if (/chart/i.test(uri)) {
      this.charts += 1;
      return;
    }
    if (/diagram/i.test(uri)) {
      this.diagrams += 1;
      return;
    }

    const textBox = descendant(frame, "wps", "txbx");
    if (textBox) {
      const inner: PlateNode[] = [];
      await this.blocks(elements(child(textBox, "w", "txbxContent")), inner, false);
      for (const block of inner) items.push({ kind: "block", node: block });
      return;
    }

    const blip = descendant(frame, "a", "blip");
    const id = attr(blip, "r", "embed");
    if (!id) return;
    const extent = child(frame, "wp", "extent");
    const width = numberAttr(extent, "wp", "cx");
    const docPr = child(frame, "wp", "docPr");
    const alt = docPr?.getAttribute("descr") || "";
    const url = await this.picture(id);
    if (url) {
      items.push({ kind: "block", node: image(url, { width: width ? width / EMU_PER_PIXEL : undefined, alt }) });
    }
  }

  private async vml(pict: Element, items: Item[]) {
    const textBox = descendant(pict, "w", "txbxContent");
    if (textBox) {
      const inner: PlateNode[] = [];
      await this.blocks(elements(textBox), inner, false);
      for (const block of inner) items.push({ kind: "block", node: block });
      return;
    }
    const imageData = descendants(pict, "v", "imagedata")[0];
    const id = attr(imageData, "r", "id");
    if (!id) return;
    const style = descendant(pict, "v", "shape")?.getAttribute("style") ?? "";
    const widthPt = /width:\s*([\d.]+)pt/.exec(style);
    const url = await this.picture(id);
    if (url) items.push({ kind: "block", node: image(url, { width: widthPt ? (Number(widthPt[1]) * 4) / 3 : undefined }) });
  }

  /** Stores the picture a relationship points to, once per document. */
  private picture(id: string): Promise<string | null> {
    const relationship = this.parts.relationships.get(id);
    if (!relationship || relationship.external) return Promise.resolve(null);
    const path = resolvePart(this.parts.base, relationship.target);
    let stored = this.pictures.get(path);
    if (!stored) {
      stored = (async () => {
        const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
        if (UNSUPPORTED_PICTURES.has(extension)) {
          this.oldPictures += 1;
          return null;
        }
        const file = this.parts.zip.file(path);
        if (!file) return null;
        const bytes = await file.async("uint8array");
        this.pictureCount += 1;
        return this.context.addAttachment(`${this.parts.name} ${this.pictureCount}.${extension}`, bytes);
      })();
      this.pictures.set(path, stored);
    }
    return stored;
  }

  // ── Notes ─────────────────────────────────────────────────────────────────

  private async appendNotes(out: PlateNode[]) {
    if (!this.noteOrder.length) return;
    out.push(rule());
    for (const { id, number } of this.noteOrder) {
      const note = this.parts.notes.get(id);
      if (!note) continue;
      const inner: PlateNode[] = [];
      await this.blocks(elements(note), inner, true);
      const inlines: PlateNode[] = [];
      for (const block of inner) {
        if (inlines.length) inlines.push(text(" "));
        inlines.push(...(block.children ?? []).filter((node) => node.type !== "code_line"));
      }
      out.push(listItem(trimStart(inlines), { type: "decimal", depth: 1, start: number === 1 ? undefined : number }));
    }
  }
}

function readAlign(value: string | undefined): Align | undefined {
  switch (value) {
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    case "both":
    case "distribute":
      return "justify";
    default:
      return undefined;
  }
}

/** Joins items into inline nodes, wrapping linked runs in links. */
function assemble(items: Item[]): PlateNode[] {
  const out: PlateNode[] = [];
  let index = 0;
  while (index < items.length) {
    const item = items[index] as Extract<Item, { kind: "inline" }>;
    if (item.href) {
      const linked: PlateNode[] = [];
      while (index < items.length && (items[index] as Extract<Item, { kind: "inline" }>).href === item.href) {
        linked.push((items[index] as Extract<Item, { kind: "inline" }>).node);
        index += 1;
      }
      out.push(link(item.href, linked));
    } else {
      out.push(item.node);
      index += 1;
    }
  }
  return out;
}

function hasContent(inlines: PlateNode[]) {
  return inlines.some((node) => typeof node.text !== "string" || node.text.trim() !== "");
}

function trimStart(inlines: PlateNode[]): PlateNode[] {
  const out = [...inlines];
  while (out.length && typeof out[0].text === "string" && !out[0].text.trim()) out.shift();
  if (out.length && typeof out[0].text === "string") out[0] = { ...out[0], text: out[0].text.replace(/^[\s]+/, "") };
  return out;
}

function trimEnd(inlines: PlateNode[]): PlateNode[] {
  const out = [...inlines];
  while (out.length && typeof out[out.length - 1].text === "string" && !(out[out.length - 1].text as string).trim()) out.pop();
  const last = out[out.length - 1];
  if (last && typeof last.text === "string") out[out.length - 1] = { ...last, text: last.text.replace(/\s+$/, "") };
  return out;
}

/** Removes the first `count` characters of text from some inlines. */
function stripLeading(inlines: PlateNode[], count: number): PlateNode[] {
  let remaining = count;
  const out: PlateNode[] = [];
  for (const node of inlines) {
    if (remaining > 0 && typeof node.text === "string") {
      const cut = Math.min(remaining, node.text.length);
      remaining -= cut;
      if (cut < node.text.length) out.push({ ...node, text: node.text.slice(cut) });
      continue;
    }
    out.push(node);
  }
  return out;
}

/** A short language name right above a code block, as Word exports label it. */
function labelCode(blocks: PlateNode[]): PlateNode[] {
  if (blocks.length === 2 && blocks[0].type === "p" && blocks[1].type === "code_block") {
    const language = LANGUAGE_BY_LABEL.get(plainText(blocks[0].children).trim().toLowerCase());
    if (language) return [{ ...blocks[1], lang: language }];
  }
  return blocks;
}

/** A relationship target as a path inside the package. */
export function resolvePart(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").filter(Boolean);
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment && segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}

/** A paragraph whose only content is one link to a place in the document. */
function isContentsEntry(node: Element) {
  if (!is(node, "w", "p")) return false;
  let link: Element | null = null;
  for (const element of elements(node)) {
    if (is(element, "w", "pPr") || is(element, "w", "bookmarkStart") || is(element, "w", "bookmarkEnd")) continue;
    if (link || !is(element, "w", "hyperlink") || !attr(element, "w", "anchor")) return false;
    link = element;
  }
  return !!link && !!link.textContent?.trim();
}
