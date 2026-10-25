import type { ListType } from "../../nodes";
import { attr, child, children, elements, flag, is, numberAttr, val } from "./xml";
import type { XmlDocument, XmlElement } from "./xml-tree";

/** Run formatting as Word layers it: `undefined` means "not set here". */
export interface RunProps {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  vertAlign?: "superscript" | "subscript" | "baseline";
  /** `#rrggbb`, or `auto`. */
  color?: string;
  /** Word's highlight name (`yellow`) or a shading fill as `#rrggbb`. */
  highlight?: string;
  shading?: string;
  /** Half-points. */
  size?: number;
  font?: string;
  caps?: boolean;
  hidden?: boolean;
}

export interface ParagraphProps {
  align?: string;
  /** Twips. */
  indentLeft?: number;
  /** Line spacing as a multiple, only for `auto` spacing. */
  lineSpacing?: number;
  numId?: string;
  ilvl?: number;
  outlineLevel?: number;
}

interface Style {
  id: string;
  name: string;
  type: string;
  basedOn: string | null;
  paragraph: ParagraphProps;
  run: RunProps;
}

export function readRunProps(rPr: XmlElement | null): RunProps {
  if (!rPr) return {};
  const props: RunProps = {};
  const set = <K extends keyof RunProps>(key: K, value: RunProps[K] | undefined) => {
    if (value !== undefined) props[key] = value;
  };

  set("bold", flag(rPr, "b"));
  set("italic", flag(rPr, "i"));
  const underline = val(rPr, "u");
  if (child(rPr, "w", "u")) props.underline = underline !== "none";
  const strike = flag(rPr, "strike");
  const doubleStrike = flag(rPr, "dstrike");
  if (strike !== undefined || doubleStrike !== undefined) props.strike = !!(strike || doubleStrike);
  const vertAlign = val(rPr, "vertAlign");
  if (vertAlign === "superscript" || vertAlign === "subscript" || vertAlign === "baseline") props.vertAlign = vertAlign;
  const color = val(rPr, "color");
  if (color) props.color = color.toLowerCase() === "auto" ? "auto" : `#${color.toLowerCase()}`;
  const highlight = val(rPr, "highlight");
  if (highlight) props.highlight = highlight;
  const shading = attr(child(rPr, "w", "shd"), "w", "fill");
  if (shading) props.shading = shading.toLowerCase() === "auto" ? "auto" : `#${shading.toLowerCase()}`;
  const size = numberAttr(child(rPr, "w", "sz"), "w", "val");
  if (size !== null) props.size = size;
  const fonts = child(rPr, "w", "rFonts");
  const font = attr(fonts, "w", "ascii") ?? attr(fonts, "w", "hAnsi");
  if (font) props.font = font;
  set("caps", flag(rPr, "caps"));
  set("hidden", flag(rPr, "vanish"));
  return props;
}

export function readParagraphProps(pPr: XmlElement | null): ParagraphProps {
  if (!pPr) return {};
  const props: ParagraphProps = {};
  const align = val(pPr, "jc");
  if (align) props.align = align;
  const ind = child(pPr, "w", "ind");
  const left = numberAttr(ind, "w", "left") ?? numberAttr(ind, "w", "start");
  if (left !== null) props.indentLeft = left;
  const spacing = child(pPr, "w", "spacing");
  const line = numberAttr(spacing, "w", "line");
  const rule = attr(spacing, "w", "lineRule");
  if (line !== null && (rule === null || rule === "auto")) props.lineSpacing = line / 240;
  const numPr = child(pPr, "w", "numPr");
  if (numPr) {
    const numId = val(numPr, "numId");
    if (numId !== null) props.numId = numId;
    const ilvl = numberAttr(child(numPr, "w", "ilvl"), "w", "val");
    if (ilvl !== null) props.ilvl = ilvl;
  }
  const outline = numberAttr(child(pPr, "w", "outlineLvl"), "w", "val");
  if (outline !== null) props.outlineLevel = outline;
  return props;
}

const MONOSPACE = /mono|courier|consolas|menlo|monaco|lucida console|source code|fira code|cascadia|inconsolata|hack\b/i;

export function isMonospace(font: string | undefined) {
  return !!font && MONOSPACE.test(font);
}

export interface ResolvedParagraphStyle {
  headingLevel: number | null;
  kind: "title" | "subtitle" | "quote" | "code" | "toc" | "caption" | "normal";
  paragraph: ParagraphProps;
  /** Run formatting the paragraph style gives its text. */
  run: RunProps;
}

export class Styles {
  private readonly styles = new Map<string, Style>();
  private readonly resolved = new Map<string, ResolvedParagraphStyle>();
  readonly defaultRun: RunProps;
  readonly defaultParagraph: ParagraphProps;
  private defaultParagraphStyle: string | null = null;

  constructor(document: XmlDocument | null) {
    const root = document?.documentElement ?? null;
    const defaults = child(root, "w", "docDefaults");
    this.defaultRun = readRunProps(child(child(defaults, "w", "rPrDefault"), "w", "rPr"));
    this.defaultParagraph = readParagraphProps(child(child(defaults, "w", "pPrDefault"), "w", "pPr"));

    for (const element of children(root, "w", "style")) {
      const id = attr(element, "w", "styleId");
      if (!id) continue;
      const type = attr(element, "w", "type") ?? "paragraph";
      this.styles.set(id, {
        id,
        name: (val(element, "name") ?? id).toLowerCase(),
        type,
        basedOn: val(element, "basedOn"),
        paragraph: readParagraphProps(child(element, "w", "pPr")),
        run: readRunProps(child(element, "w", "rPr")),
      });
      if (type === "paragraph" && /^(1|true|on)$/.test(attr(element, "w", "default") ?? "")) {
        this.defaultParagraphStyle = id;
      }
    }
  }

  private chain(id: string | null): Style[] {
    const out: Style[] = [];
    const seen = new Set<string>();
    let current = id ? this.styles.get(id) : undefined;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      out.unshift(current);
      current = current.basedOn ? this.styles.get(current.basedOn) : undefined;
    }
    return out;
  }

  /** Run formatting from a character style, base styles first. */
  characterRun(id: string | null): RunProps {
    return Object.assign({}, ...this.chain(id).map((style) => style.run));
  }

  paragraphStyle(id: string | null): ResolvedParagraphStyle {
    const key = id ?? this.defaultParagraphStyle ?? "";
    const cached = this.resolved.get(key);
    if (cached) return cached;

    const chain = this.chain(id ?? this.defaultParagraphStyle);
    const paragraph: ParagraphProps = Object.assign({}, this.defaultParagraph, ...chain.map((style) => style.paragraph));
    const run: RunProps = Object.assign({}, ...chain.map((style) => style.run));
    const names = chain.map((style) => style.name);
    const own = names[names.length - 1] ?? "";

    let headingLevel: number | null = null;
    let kind: ResolvedParagraphStyle["kind"] = "normal";
    const headingName = names
      .map((name) => /^heading\s*(\d)$/.exec(name) ?? /^berschrift\s*(\d)$/.exec(name))
      .find(Boolean);
    if (own === "title") {
      headingLevel = 1;
      kind = "title";
    } else if (own === "subtitle") {
      kind = "subtitle";
    } else if (headingName) {
      headingLevel = Number(headingName[1]);
    } else if (paragraph.outlineLevel !== undefined && paragraph.outlineLevel < 9) {
      headingLevel = paragraph.outlineLevel + 1;
    } else if (/^toc\s*\d|^toc heading$|^table of contents/.test(own)) {
      kind = "toc";
    } else if (names.some((name) => /quote/.test(name))) {
      kind = "quote";
    } else if (names.some((name) => /code|preformatted|source|plain text/.test(name)) || isMonospace(run.font)) {
      kind = "code";
    } else if (own === "caption") {
      kind = "caption";
    }

    const resolved = { headingLevel: headingLevel ? Math.min(headingLevel, 6) : null, kind, paragraph, run };
    this.resolved.set(key, resolved);
    return resolved;
  }

  /** The text size of ordinary paragraphs, in half-points. */
  get bodySize(): number {
    return this.paragraphStyle(null).run.size ?? this.defaultRun.size ?? 22;
  }
}

interface Level {
  format: string;
  text: string;
  start: number;
  /** Twips. */
  indent: number | null;
}

export interface ListLevel {
  type: ListType | null;
  start: number;
  /** How far the level indents its text, in twips. */
  indent: number | null;
  /**
   * One-level lists ("List Bullet 2" and friends) nest by indent alone, so
   * their depth comes from it.
   */
  singleLevel: boolean;
}

/** Word's numbering definitions: which list each `numId` + level is. */
export class Numbering {
  private readonly abstract = new Map<string, Map<number, Level>>();
  private readonly singleLevel = new Set<string>();
  private readonly instances = new Map<string, { abstractId: string; startOverrides: Map<number, number> }>();

  constructor(document: XmlDocument | null) {
    const root = document?.documentElement ?? null;
    for (const element of elements(root)) {
      if (is(element, "w", "abstractNum")) {
        const levels = new Map<number, Level>();
        for (const level of children(element, "w", "lvl")) {
          levels.set(Number(attr(level, "w", "ilvl") ?? 0), {
            format: val(level, "numFmt") ?? "decimal",
            text: val(level, "lvlText") ?? "",
            start: numberAttr(child(level, "w", "start"), "w", "val") ?? 1,
            indent: readParagraphProps(child(level, "w", "pPr")).indentLeft ?? null,
          });
        }
        const abstractId = attr(element, "w", "abstractNumId") ?? "";
        this.abstract.set(abstractId, levels);
        if (val(element, "multiLevelType") === "singleLevel" || levels.size === 1) this.singleLevel.add(abstractId);
      } else if (is(element, "w", "num")) {
        const overrides = new Map<number, number>();
        for (const override of children(element, "w", "lvlOverride")) {
          const start = numberAttr(child(override, "w", "startOverride"), "w", "val");
          if (start !== null) overrides.set(Number(attr(override, "w", "ilvl") ?? 0), start);
        }
        this.instances.set(attr(element, "w", "numId") ?? "", {
          abstractId: val(element, "abstractNumId") ?? "",
          startOverrides: overrides,
        });
      }
    }
  }

  level(numId: string, ilvl: number): ListLevel | null {
    if (numId === "0") return null;
    const instance = this.instances.get(numId);
    const level = instance ? this.abstract.get(instance.abstractId)?.get(ilvl) : undefined;
    if (!instance || !level) return null;
    const start = instance.startOverrides.get(ilvl) ?? level.start;
    return { type: listType(level, ilvl), start, indent: level.indent, singleLevel: this.singleLevel.has(instance.abstractId) };
  }
}

function listType(level: Level, ilvl: number): ListType | null {
  switch (level.format) {
    case "none":
      return null;
    case "bullet": {
      if (/[☐□❑❒]/.test(level.text)) return "todo";
      if (level.text === "o" || level.text === "◦" || level.text === "○") return "circle";
      if (/[§▪■]/.test(level.text) || level.text === "") return "square";
      return (["disc", "circle", "square"] as const)[ilvl % 3];
    }
    case "lowerLetter":
      return "lower-alpha";
    case "upperLetter":
      return "upper-alpha";
    case "lowerRoman":
      return "lower-roman";
    case "upperRoman":
      return "upper-roman";
    default:
      return "decimal";
  }
}
