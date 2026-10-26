/**
 * The XML tree the Word reader walks: the few parts of the DOM it uses.
 * Word files are read in a worker, which has no `DOMParser`, so this parses
 * them itself. It gives the nodes `DOMParser` would, leaving out comments and
 * processing instructions, which nothing reads, and is about as fast as
 * WebKit's own parser (the JavaScript ones tried were three to four times
 * slower there). A file that isn't well-formed XML is refused, and entities
 * a file declares itself are never expanded.
 */

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

export type XmlNode = XmlElement | XmlText;

export class XmlText {
  nextSibling: XmlNode | null = null;

  constructor(
    /** 3 for text, 4 for CDATA, as in the DOM. */
    readonly nodeType: 3 | 4,
    readonly textContent: string,
  ) {}
}

interface XmlAttribute {
  name: string;
  uri: string;
  local: string;
  value: string;
}

export class XmlElement {
  readonly nodeType = 1;
  firstChild: XmlNode | null = null;
  lastChild: XmlNode | null = null;
  nextSibling: XmlNode | null = null;

  constructor(
    /** The name as written, `w:p`, to match the end tag against. */
    readonly tagName: string,
    readonly localName: string,
    readonly namespaceURI: string | null,
    private readonly attributes: XmlAttribute[],
  ) {}

  getAttribute(name: string): string | null {
    for (const attribute of this.attributes) if (attribute.name === name) return attribute.value;
    return null;
  }

  getAttributeNS(uri: string, local: string): string | null {
    for (const attribute of this.attributes) if (attribute.uri === uri && attribute.local === local) return attribute.value;
    return null;
  }

  get textContent(): string {
    let out = "";
    for (let node = this.firstChild; node; node = node.nextSibling) out += node.textContent;
    return out;
  }

  append(node: XmlNode) {
    if (this.lastChild) this.lastChild.nextSibling = node;
    else this.firstChild = node;
    this.lastChild = node;
  }
}

export interface XmlDocument {
  documentElement: XmlElement;
}

class Damaged extends Error {
  constructor() {
    super("The document's XML is damaged.");
  }
}

const NAMED_ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeEntities(raw: string) {
  if (!raw.includes("&")) return raw;
  return raw.replace(/&([^;&]*)(;?)/g, (_, name: string, semicolon: string) => {
    if (!semicolon) throw new Damaged();
    if (name.startsWith("#")) {
      const code = /^#x[0-9a-f]+$/i.test(name) ? parseInt(name.slice(2), 16) : /^#[0-9]+$/.test(name) ? Number(name.slice(1)) : NaN;
      if (!(code > 0 && code <= 0x10ffff)) throw new Damaged();
      return String.fromCodePoint(code);
    }
    const value = NAMED_ENTITIES[name];
    if (value === undefined) throw new Damaged();
    return value;
  });
}

/** Line ends as XML reads them: `\r\n` and `\r` are `\n`. */
function lineEnds(raw: string) {
  return raw.includes("\r") ? raw.replace(/\r\n?/g, "\n") : raw;
}

const isSpace = (code: number) => code === 32 || code === 9 || code === 10 || code === 13;

/** Prefixes in scope, each element's own declarations over its parent's. */
type Scope = Record<string, string>;

export function parseXml(source: string): XmlDocument {
  const parser = new Parser(source, true, () => false);
  parser.next();
  return parser.document;
}

/** Refuses `source` if it isn't well-formed, without building anything. */
export function checkXml(source: string) {
  new Parser(source, false, () => false).next();
}

/**
 * Reads `source` a piece at a time. The children of the element `split`
 * picks come from `next` one by one as each ends, and never join the tree,
 * so a long document is never in memory whole. `split` is asked once for
 * each element as it starts, `depth` 0 being the root.
 */
export class XmlStream {
  private readonly parser: Parser;

  constructor(source: string, split: (element: XmlElement, depth: number) => boolean) {
    this.parser = new Parser(source, true, split);
  }

  /** The next child of a split element, or `null` at the end. */
  next(): XmlElement | null {
    return this.parser.next();
  }
}

class Parser {
  private at: number;
  private readonly names: string[] = [];
  /** Open elements; only when building. */
  private readonly open: XmlElement[] = [];
  /** Whether each open element hands its children out. */
  private readonly splits: boolean[] = [];
  private readonly scopes: Scope[] = [];
  private scope: Scope = Object.assign(Object.create(null) as Scope, { xml: XML_NAMESPACE, xmlns: XMLNS_NAMESPACE, "": "" });
  private root: XmlElement | null = null;
  private hasRoot = false;
  private ended = false;

  constructor(
    private readonly source: string,
    private readonly build: boolean,
    private readonly split: (element: XmlElement, depth: number) => boolean,
  ) {
    this.at = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  }

  get document(): XmlDocument {
    if (!this.ended || !this.root) throw new Error("The XML hasn't been read to the end.");
    return { documentElement: this.root };
  }

  next(): XmlElement | null {
    try {
      return this.read();
    } catch (error) {
      if (error instanceof Damaged) throw error;
      throw new Damaged();
    }
  }

  private read(): XmlElement | null {
    const { source, names, open, splits, build } = this;
    const length = source.length;
    let at = this.at;

    while (at < length) {
      const lt = source.indexOf("<", at);
      const textEnd = lt < 0 ? length : lt;
      if (textEnd > at) {
        const raw = source.slice(at, textEnd);
        if (!names.length) {
          if (raw.trim()) throw new Damaged();
        } else if (build && !splits[splits.length - 1]) {
          open[open.length - 1].append(new XmlText(3, decodeEntities(lineEnds(raw))));
        } else {
          // Only checked: text right inside a split element isn't kept.
          decodeEntities(raw);
        }
      }
      if (lt < 0) break;

      const next = source.charCodeAt(lt + 1);
      if (next === 63 /* ? */) {
        const end = source.indexOf("?>", lt + 2);
        if (end < 0) throw new Damaged();
        at = end + 2;
        continue;
      }
      if (next === 33 /* ! */) {
        at = this.skipMarkup(lt);
        continue;
      }
      if (next === 47 /* / */) {
        const end = source.indexOf(">", lt + 2);
        if (end < 0) throw new Damaged();
        const name = names.pop();
        if (name === undefined || name !== source.slice(lt + 2, end).trimEnd()) throw new Damaged();
        splits.pop();
        this.scope = this.scopes.pop()!;
        at = end + 1;
        if (build) {
          const element = open.pop()!;
          if (splits[splits.length - 1]) {
            this.at = at;
            return element;
          }
        }
        continue;
      }

      // A start tag: its name, then attributes up to `>` or `/>`.
      let position = lt + 1;
      while (position < length) {
        const code = source.charCodeAt(position);
        if (isSpace(code) || code === 47 || code === 62) break;
        position += 1;
      }
      const tagName = source.slice(lt + 1, position);
      if (!tagName) throw new Damaged();
      const written: [string, string][] = [];
      let empty = false;
      for (;;) {
        while (position < length && isSpace(source.charCodeAt(position))) position += 1;
        const code = source.charCodeAt(position);
        if (position >= length) throw new Damaged();
        if (code === 62) {
          position += 1;
          break;
        }
        if (code === 47) {
          if (source.charCodeAt(position + 1) !== 62) throw new Damaged();
          empty = true;
          position += 2;
          break;
        }
        const equals = source.indexOf("=", position);
        if (equals < 0) throw new Damaged();
        const name = source.slice(position, equals).trimEnd();
        if (!name || /[\s<>"'/]/.test(name)) throw new Damaged();
        let quoteAt = equals + 1;
        while (quoteAt < length && isSpace(source.charCodeAt(quoteAt))) quoteAt += 1;
        const quote = source[quoteAt];
        if (quote !== '"' && quote !== "'") throw new Damaged();
        const close = source.indexOf(quote, quoteAt + 1);
        if (close < 0) throw new Damaged();
        const raw = source.slice(quoteAt + 1, close);
        if (raw.includes("<")) throw new Damaged();
        // Attribute values have their white space turned into spaces.
        written.push([name, decodeEntities(lineEnds(raw).replace(/[\t\n]/g, " "))]);
        position = close + 1;
        const after = source.charCodeAt(position);
        if (!isSpace(after) && after !== 47 && after !== 62) throw new Damaged();
      }

      const parentScope = this.scope;
      let scope = parentScope;
      for (const [name, value] of written) {
        if (name !== "xmlns" && !name.startsWith("xmlns:")) continue;
        if (scope === parentScope) scope = Object.create(scope) as Scope;
        scope[name === "xmlns" ? "" : name.slice(6)] = value;
      }
      const seen = new Set<string>();
      const attributes = written.map(([name, value]): XmlAttribute => {
        if (seen.has(name)) throw new Damaged();
        seen.add(name);
        if (name === "xmlns") return { name, uri: XMLNS_NAMESPACE, local: name, value };
        const colon = name.indexOf(":");
        if (colon < 0) return { name, uri: "", local: name, value };
        const uri = scope[name.slice(0, colon)];
        if (uri === undefined) throw new Damaged();
        return { name, uri, local: name.slice(colon + 1), value };
      });
      const colon = tagName.indexOf(":");
      const uri = scope[colon < 0 ? "" : tagName.slice(0, colon)];
      if (uri === undefined) throw new Damaged();

      if (!names.length) {
        if (this.hasRoot) throw new Damaged();
        this.hasRoot = true;
      }
      let splitting = false;
      let element: XmlElement | null = null;
      if (build) {
        element = new XmlElement(tagName, colon < 0 ? tagName : tagName.slice(colon + 1), uri || null, attributes);
        const handedOut = splits[splits.length - 1];
        if (!names.length) this.root = element;
        else if (!handedOut) open[open.length - 1].append(element);
        splitting = this.split(element, names.length);
      }
      at = position;
      if (empty) {
        if (build && splits[splits.length - 1]) {
          this.at = at;
          return element;
        }
        continue;
      }
      names.push(tagName);
      splits.push(splitting);
      this.scopes.push(parentScope);
      this.scope = scope;
      if (build) open.push(element!);
    }

    if (names.length || !this.hasRoot) throw new Damaged();
    this.at = length;
    this.ended = true;
    return null;
  }

  /** Skips a comment or the doctype, or reads a CDATA section; returns where it ends. */
  private skipMarkup(lt: number) {
    const { source } = this;
    if (source.startsWith("!--", lt + 1)) {
      const end = source.indexOf("-->", lt + 4);
      if (end < 0) throw new Damaged();
      return end + 3;
    }
    if (source.startsWith("![CDATA[", lt + 1)) {
      const end = source.indexOf("]]>", lt + 9);
      if (end < 0 || !this.names.length) throw new Damaged();
      if (this.build && !this.splits[this.splits.length - 1]) {
        this.open[this.open.length - 1].append(new XmlText(4, lineEnds(source.slice(lt + 9, end))));
      }
      return end + 3;
    }
    if (source.startsWith("!DOCTYPE", lt + 1) && !this.hasRoot) {
      // Declarations inside `[...]` are skipped; entities they declare stay unknown.
      let depth = 0;
      for (let position = lt + 9; position < source.length; position += 1) {
        const char = source[position];
        if (char === "[") depth += 1;
        else if (char === "]") depth -= 1;
        else if (char === ">" && depth === 0) return position + 1;
      }
    }
    throw new Damaged();
  }
}
