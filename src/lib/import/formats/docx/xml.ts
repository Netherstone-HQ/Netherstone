import type { XmlElement, XmlNode } from "./xml-tree";

/**
 * Reading Office Open XML. Elements are matched by local name and by
 * namespace family, so both the usual Transitional namespaces and the Strict
 * ones (`purl.oclc.org`) work, whatever prefixes the writing app chose.
 */

const NAMESPACES = {
  w: ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"],
  r: [
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "http://purl.oclc.org/ooxml/officeDocument/relationships",
  ],
  m: ["http://schemas.openxmlformats.org/officeDocument/2006/math", "http://purl.oclc.org/ooxml/officeDocument/math"],
  a: ["http://schemas.openxmlformats.org/drawingml/2006/main", "http://purl.oclc.org/ooxml/drawingml/main"],
  wp: [
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing",
  ],
  v: ["urn:schemas-microsoft-com:vml"],
  w14: ["http://schemas.microsoft.com/office/word/2010/wordml"],
  mc: ["http://schemas.openxmlformats.org/markup-compatibility/2006"],
  wps: ["http://schemas.microsoft.com/office/word/2010/wordprocessingShape"],
  pr: ["http://schemas.openxmlformats.org/package/2006/relationships"],
  dc: ["http://purl.org/dc/elements/1.1/"],
} as const;

export type Namespace = keyof typeof NAMESPACES;

export function is(node: XmlNode | null | undefined, ns: Namespace, name: string): boolean {
  return (
    !!node &&
    node.nodeType === 1 &&
    (node as XmlElement).localName === name &&
    (NAMESPACES[ns] as readonly string[]).includes((node as XmlElement).namespaceURI ?? "")
  );
}

export function elements(parent: XmlElement | null | undefined): XmlElement[] {
  if (!parent) return [];
  const out: XmlElement[] = [];
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === 1) out.push(node as XmlElement);
  }
  return out;
}

export function children(parent: XmlElement | null | undefined, ns: Namespace, name: string): XmlElement[] {
  return elements(parent).filter((element) => is(element, ns, name));
}

export function child(parent: XmlElement | null | undefined, ns: Namespace, name: string): XmlElement | null {
  if (!parent) return null;
  for (let node = parent.firstChild; node; node = node.nextSibling) {
    if (is(node, ns, name)) return node as XmlElement;
  }
  return null;
}

/** The first descendant `ns:name`, depth first. */
export function descendant(parent: XmlElement | null | undefined, ns: Namespace, name: string): XmlElement | null {
  if (!parent) return null;
  for (const element of elements(parent)) {
    if (is(element, ns, name)) return element;
    const inner = descendant(element, ns, name);
    if (inner) return inner;
  }
  return null;
}

export function descendants(parent: XmlElement | null | undefined, ns: Namespace, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const element of elements(parent)) {
    if (is(element, ns, name)) out.push(element);
    else descendants(element, ns, name, out);
  }
  return out;
}

export function attr(element: XmlElement | null | undefined, ns: Namespace, name: string): string | null {
  if (!element) return null;
  for (const uri of NAMESPACES[ns]) {
    const value = element.getAttributeNS(uri, name);
    if (value !== null && value !== "") return value;
  }
  // Some writers leave attributes unprefixed.
  return element.getAttribute(name);
}

/** `w:val` of a child property element, e.g. `val(pPr, "jc")`. */
export function val(parent: XmlElement | null | undefined, name: string, ns: Namespace = "w"): string | null {
  return attr(child(parent, ns, name), ns, "val");
}

/**
 * An on/off property: present without a value, or with `true`/`1`/`on`, is
 * on. Absent is `undefined`, so styles can be layered.
 */
export function flag(parent: XmlElement | null | undefined, name: string): boolean | undefined {
  const element = child(parent, "w", name);
  if (!element) return undefined;
  const value = attr(element, "w", "val");
  return value === null || !["false", "0", "off", "none"].includes(value.toLowerCase());
}

export function numberAttr(element: XmlElement | null | undefined, ns: Namespace, name: string): number | null {
  const value = attr(element, ns, name);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
