import {
  blockquote,
  codeBlock,
  heading,
  image,
  isEmptyParagraph,
  link,
  listItem,
  isTextColor,
  normalizeColor,
  paragraph,
  plainText,
  rule,
  table,
  text,
  type Align,
  type CellInput,
  type ListType,
  type Marks,
} from "../nodes";
import type { ImportContext, Importer, PlateNode } from "../types";
import { decodeText } from "./decode-text";
import { IMPORT_FORMATS } from "./list";

/**
 * Web pages and HTML exports (Notion, Google Docs, Evernote, browsers'
 * "Save page"). Structure, inline formatting, colours, alignment, tables
 * with merged cells and pictures come across; scripts, styles, forms and
 * page furniture are left out.
 */
export const htmlImporter: Importer = {
  ...IMPORT_FORMATS.html,
  async convert(file, context) {
    const source = decodeText(await file.read());
    const document = new DOMParser().parseFromString(source, "text/html");
    return { nodes: await htmlToNodes(document.body, context) };
  },
};

const SKIPPED = new Set([
  "script", "style", "noscript", "template", "head", "meta", "link", "title",
  "button", "input", "select", "textarea", "form", "nav", "svg", "canvas", "iframe", "object", "embed",
]);

const BLOCKS = new Set([
  "address", "article", "aside", "blockquote", "body", "center", "dd", "details", "dialog", "div", "dl", "dt",
  "fieldset", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr",
  "li", "main", "ol", "p", "pre", "section", "summary", "table", "ul",
]);

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const PAGE_LINK = /\.(html?|md|markdown)$/i;

function tag(element: Element) {
  return element.tagName.toLowerCase();
}

function cssValue(element: Element, property: string): string | null {
  const style = (element as HTMLElement).style;
  const value = style?.getPropertyValue(property);
  return value ? value.trim().toLowerCase() : null;
}

function readAlign(element: Element): Align | undefined {
  const value = cssValue(element, "text-align") ?? element.getAttribute("align")?.toLowerCase();
  if (value === "center" || value === "right" || value === "justify") return value;
  if (tag(element) === "center") return "center";
  return undefined;
}

/** Pixels from a CSS length in px, pt or em; null for anything else. */
function pixels(value: string | null): number | null {
  if (!value) return null;
  const match = /^([\d.]+)(px|pt|em|rem)?$/.exec(value.trim());
  if (!match) return null;
  const number = parseFloat(match[1]);
  switch (match[2]) {
    case "pt":
      return (number * 4) / 3;
    case "em":
    case "rem":
      return number * 16;
    default:
      return number;
  }
}

function marksFrom(element: Element, inherited: Marks): Marks {
  const marks: Marks = { ...inherited };
  switch (tag(element)) {
    case "b":
    case "strong":
      marks.bold = true;
      break;
    case "i":
    case "em":
    case "cite":
    case "dfn":
    case "var":
      marks.italic = true;
      break;
    case "u":
    case "ins":
      marks.underline = true;
      break;
    case "s":
    case "strike":
    case "del":
      marks.strikethrough = true;
      break;
    case "code":
    case "kbd":
    case "samp":
    case "tt":
      marks.code = true;
      break;
    case "sub":
      marks.subscript = true;
      break;
    case "sup":
      marks.superscript = true;
      break;
    case "mark":
      marks.highlight = true;
      break;
  }

  const weight = cssValue(element, "font-weight");
  if (weight === "bold" || weight === "bolder" || (weight && Number(weight) >= 600)) marks.bold = true;
  if (weight === "normal" || (weight && Number(weight) > 0 && Number(weight) < 600)) delete marks.bold;
  if (cssValue(element, "font-style") === "italic") marks.italic = true;
  const decoration = cssValue(element, "text-decoration") ?? cssValue(element, "text-decoration-line") ?? "";
  if (decoration.includes("underline")) marks.underline = true;
  if (decoration.includes("line-through")) marks.strikethrough = true;
  const verticalAlign = cssValue(element, "vertical-align");
  if (verticalAlign === "super") marks.superscript = true;
  if (verticalAlign === "sub") marks.subscript = true;

  const color = normalizeColor(cssValue(element, "color") ?? element.getAttribute("color"));
  // Black text is the page's default colour, not a choice worth keeping.
  if (color && !isTextColor(color)) marks.color = color;
  const background = normalizeColor(cssValue(element, "background-color"));
  if (background && background !== "#ffffff" && !marks.code) marks.backgroundColor = background;

  const size = pixels(cssValue(element, "font-size"));
  if (size && Math.abs(size - 16) >= 2 && size <= 96) marks.fontSize = `${Math.round(size)}px`;
  return marks;
}

class HtmlReader {
  private readonly blocks: PlateNode[] = [];
  private inline: PlateNode[] = [];
  private align: Align | undefined;
  private visited = 0;
  private dataImages = 0;

  constructor(private readonly context: ImportContext) {}

  async read(root: Element) {
    await this.blockChildren(root, {});
    this.flush();
    // Pages are full of empty spacer elements; keep none at the ends.
    while (this.blocks.length && isEmptyParagraph(this.blocks[0])) this.blocks.shift();
    while (this.blocks.length && isEmptyParagraph(this.blocks[this.blocks.length - 1])) this.blocks.pop();
    return this.blocks.filter((block, index, all) => !(isEmptyParagraph(block) && index > 0 && isEmptyParagraph(all[index - 1])));
  }

  private flush() {
    const content = trimInlines(this.inline);
    this.inline = [];
    if (content.length) this.blocks.push(paragraph(content, { align: this.align }));
    this.align = undefined;
  }

  private async tick() {
    this.visited += 1;
    if (this.visited % 400 === 0) await this.context.checkpoint();
  }

  private async blockChildren(element: Element, marks: Marks) {
    for (const child of Array.from(element.childNodes)) await this.node(child, marks);
  }

  private async node(node: Node, marks: Marks) {
    await this.tick();
    if (node.nodeType === Node.TEXT_NODE) {
      const value = (node.textContent ?? "").replace(/[\s ]+/g, (space) => (space.includes(" ") ? " " : " "));
      if (value) this.inline.push(text(value, marks));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as Element;
    const name = tag(element);
    if (SKIPPED.has(name) || element.getAttribute("hidden") !== null || cssValue(element, "display") === "none") return;

    if (!BLOCKS.has(name)) {
      await this.inlineElement(element, marks);
      return;
    }

    this.flush();
    switch (name) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const content = await this.collectInlines(element, {});
        if (plainText(content).trim()) this.blocks.push(heading(Number(name[1]), trimInlines(content), { align: readAlign(element) }));
        return;
      }
      case "p": {
        this.align = readAlign(element);
        await this.blockChildren(element, marksFrom(element, marks));
        this.flush();
        return;
      }
      case "hr":
        this.blocks.push(rule());
        return;
      case "pre": {
        const code = element.textContent ?? "";
        const language = /(?:language|lang)-([\w+-]+)/.exec(
          `${element.className} ${element.querySelector("code")?.className ?? ""}`,
        )?.[1];
        this.blocks.push(codeBlock(code.replace(/\n$/, "").split("\n"), language));
        return;
      }
      case "blockquote": {
        const inner = await this.subBlocks(element, marks);
        const lines = inner.map((block) => trimInlines(block.children ?? []));
        const children: PlateNode[] = [];
        lines.forEach((line, index) => {
          if (index > 0) children.push(text("\n"));
          children.push(...line);
        });
        if (plainText(children).trim()) this.blocks.push(blockquote(children));
        return;
      }
      case "ul":
      case "ol":
        await this.list(element, 1, marks);
        return;
      case "table":
        await this.table(element);
        return;
      case "figure": {
        await this.blockChildren(element, marks);
        this.flush();
        return;
      }
      case "summary":
      case "dt": {
        const content = await this.collectInlines(element, { ...marks, bold: true });
        if (plainText(content).trim()) this.blocks.push(paragraph(trimInlines(content)));
        return;
      }
      default: {
        const align = readAlign(element);
        if (align) this.align = align;
        await this.blockChildren(element, marksFrom(element, marks));
        this.flush();
      }
    }
  }

  /** Runs `element`'s content through a fresh reader and returns its blocks. */
  private async subBlocks(element: Element, marks: Marks) {
    const reader = new HtmlReader(this.context);
    reader.visited = this.visited;
    await reader.blockChildren(element, marks);
    reader.flush();
    this.visited = reader.visited;
    this.dataImages = Math.max(this.dataImages, reader.dataImages);
    return reader.blocks;
  }

  private async collectInlines(element: Element, marks: Marks) {
    const saved = this.inline;
    this.inline = [];
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE && BLOCKS.has(tag(child as Element))) {
        // A heading or item with blocks inside reads as one line.
        this.inline.push(...(await this.collectInlines(child as Element, marks)), text(" "));
      } else {
        await this.node(child, marks);
      }
    }
    const collected = this.inline;
    this.inline = saved;
    return collected;
  }

  private async inlineElement(element: Element, marks: Marks) {
    const name = tag(element);
    if (name === "br") {
      this.inline.push(text("\n", marks));
      return;
    }
    if (name === "img") {
      await this.image(element);
      return;
    }
    if (name === "a") {
      const href = element.getAttribute("href")?.trim() ?? "";
      const children = await this.collectInlines(element, marksFrom(element, marks));
      const target = await this.linkTarget(href);
      if (target && plainText(children).trim()) this.inline.push(link(target, trimInlines(children)));
      else this.inline.push(...children);
      return;
    }
    for (const child of Array.from(element.childNodes)) await this.node(child, marksFrom(element, marks));
  }

  private async linkTarget(href: string): Promise<string | null> {
    if (!href || href.startsWith("#") || /^javascript:/i.test(href)) return null;
    if (URL_SCHEME.test(href)) return /^(https?|mailto|tel):/i.test(href) ? href : null;
    const path = href.split(/[?#]/)[0];
    const linked = this.context.linkTo(path);
    if (linked) return linked;
    // A page or note that wasn't imported isn't an attachment.
    return PAGE_LINK.test(path) ? null : await this.context.attachRelated(path);
  }

  private async image(element: Element) {
    const src = element.getAttribute("src")?.trim() ?? "";
    const alt = element.getAttribute("alt")?.trim() ?? "";
    const width = pixels(element.getAttribute("width")) ?? pixels(cssValue(element, "width"));
    // Tracking pixels and spacers.
    if (width !== null && width <= 2) return;

    let url: string | null = null;
    if (src.startsWith("data:")) {
      const match = /^data:image\/([\w.+-]+);base64,(.*)$/s.exec(src);
      if (match) {
        this.dataImages += 1;
        const extension = match[1] === "jpeg" ? "jpg" : match[1].replace("svg+xml", "svg");
        url = await this.context.addAttachment(`image-${this.dataImages}.${extension}`, base64Bytes(match[2]));
      }
    } else if (/^https?:/i.test(src)) {
      url = src;
    } else if (src) {
      url = await this.context.attachRelated(src.split(/[?#]/)[0]);
    }
    if (!url) return;

    this.flush();
    this.blocks.push(image(url, { width: width ?? undefined, alt }));
  }

  private async list(element: Element, depth: number, marks: Marks) {
    const ordered = tag(element) === "ol";
    const type = ordered ? orderedType(element.getAttribute("type")) : depth === 1 ? "disc" : depth === 2 ? "circle" : "square";
    let start = ordered ? Number(element.getAttribute("start") ?? 1) || 1 : undefined;
    let first = true;

    for (const item of Array.from(element.children)) {
      if (tag(item) === "ul" || tag(item) === "ol") {
        await this.list(item, depth + 1, marks);
        continue;
      }
      if (tag(item) !== "li") continue;

      const checkbox = item.querySelector(":scope > input[type=checkbox], :scope > p > input[type=checkbox], :scope > label > input[type=checkbox]") as HTMLInputElement | null;
      const content: PlateNode[] = [];
      const nested: Element[] = [];
      const saved = this.inline;
      this.inline = [];
      for (const child of Array.from(item.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE && (tag(child as Element) === "ul" || tag(child as Element) === "ol")) {
          nested.push(child as Element);
        } else if (child.nodeType === Node.ELEMENT_NODE && BLOCKS.has(tag(child as Element))) {
          if (this.inline.length) this.inline.push(text("\n"));
          this.inline.push(...(await this.collectInlines(child as Element, marks)));
        } else {
          await this.node(child, marks);
        }
      }
      content.push(...this.inline);
      this.inline = saved;

      const listType: ListType = checkbox ? "todo" : type;
      this.blocks.push(
        listItem(trimInlines(content), {
          type: listType,
          depth,
          start: first && ordered ? start : undefined,
          checked: checkbox ? checkbox.hasAttribute("checked") : undefined,
        }),
      );
      first = false;
      if (start !== undefined) start += 1;
      for (const list of nested) await this.list(list, depth + 1, marks);
    }
  }

  private async table(element: Element) {
    const rows: CellInput[][] = [];
    const rowElements = Array.from(element.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr"));
    for (const row of rowElements) {
      const cells: CellInput[] = [];
      for (const cell of Array.from(row.children)) {
        const name = tag(cell);
        if (name !== "td" && name !== "th") continue;
        const blocks = await this.subBlocks(cell, {});
        cells.push({
          header: name === "th" || tag(row.parentElement!) === "thead",
          colSpan: Number(cell.getAttribute("colspan")) || 1,
          rowSpan: Number(cell.getAttribute("rowspan")) || 1,
          background: normalizeColor(cssValue(cell, "background-color") ?? cell.getAttribute("bgcolor")) ?? undefined,
          children: blocks.filter((block) => block.type !== "table"),
        });
      }
      if (cells.length) rows.push(cells);
    }
    if (!rows.length) return;

    // A one-cell table is a layout box, not data.
    if (rows.length === 1 && rows[0].length === 1) {
      this.blocks.push(...rows[0][0].children);
      return;
    }

    const widths = Array.from(element.querySelectorAll(":scope > colgroup > col, :scope > col"))
      .map((col) => pixels(col.getAttribute("width")) ?? pixels(cssValue(col, "width")) ?? 0);
    this.blocks.push(table(rows, widths.length ? widths : undefined));
  }
}

function orderedType(type: string | null): ListType {
  switch (type) {
    case "a":
      return "lower-alpha";
    case "A":
      return "upper-alpha";
    case "i":
      return "lower-roman";
    case "I":
      return "upper-roman";
    default:
      return "decimal";
  }
}

/** Trims spaces and line breaks off both ends of a run of inlines. */
function trimInlines(inlines: PlateNode[]): PlateNode[] {
  const out = inlines.map((node) => ({ ...node }));
  while (out.length && typeof out[0].text === "string" && !out[0].text.replace(/^[ \n]+/, "")) out.shift();
  while (out.length && typeof out[out.length - 1].text === "string" && !(out[out.length - 1].text as string).replace(/[ \n]+$/, "")) out.pop();
  if (out.length && typeof out[0].text === "string") out[0].text = (out[0].text as string).replace(/^[ \n]+/, "");
  const last = out[out.length - 1];
  if (last && typeof last.text === "string") last.text = last.text.replace(/[ \n]+$/, "");
  // Collapse the double spaces left where two text nodes met.
  for (let index = 1; index < out.length; index += 1) {
    const previous = out[index - 1];
    const current = out[index];
    if (typeof previous.text === "string" && typeof current.text === "string" && /[ \n]$/.test(previous.text) && current.text.startsWith(" ")) {
      current.text = current.text.replace(/^ +/, "");
    }
  }
  return out.filter((node) => typeof node.text !== "string" || node.text !== "");
}

function base64Bytes(value: string) {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function htmlToNodes(root: Element, context: ImportContext): Promise<PlateNode[]> {
  return new HtmlReader(context).read(root);
}
