// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { parseXml, type XmlElement } from "./xml-tree";

/** Elements, attributes and text as a list, the same for both trees. */
function outline(element: Element | XmlElement, names: string[][]): string[] {
  const out: string[] = [];
  const walk = (node: Element | XmlElement) => {
    const attributes = names.map(([uri, local, qualified]) => `${qualified}=${node.getAttributeNS(uri, local)}|${node.getAttribute(qualified)}`);
    out.push(`<${node.namespaceURI} ${node.localName} ${attributes.join(" ")}>`);
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) walk(child as Element | XmlElement);
      else if (child.nodeType === 3 || child.nodeType === 4) out.push(`${child.nodeType}:${child.textContent}`);
    }
    out.push(`</${node.localName} ${JSON.stringify(node.textContent)}>`);
  };
  walk(element);
  return out;
}

const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

describe("XML tree", () => {
  it("reads what DOMParser reads", () => {
    const sources = [
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t xml:space="preserve"> Tom &amp; Jerry &lt;3 &#233;&#x1F600; </w:t></w:r></w:p></w:body></w:document>`,
      `﻿<a xmlns="urn:default" xmlns:w="${W}" w:val="1" val="2"><!-- a comment --><b>text<![CDATA[ <raw> & ]]>more</b><w:c w:val='single "quoted"'/><d xmlns="">no namespace</d></a>`,
      `<a xmlns:w="${W}" w:val="line\r\nbreak\ttab&#10;kept">\r\n  <w:b xmlns:w="urn:other" w:val="inner"/>\r\n  <w:c w:val="outer"/>\r\n</a>`,
      `<?xml version="1.0"?><!DOCTYPE a [<!ELEMENT a ANY>]><a  x = "1" >  spaced  </a >`,
    ];
    const names = [
      [W, "val", "w:val"],
      ["", "val", "val"],
      ["", "x", "x"],
      ["urn:other", "val", "w:val"],
      ["http://www.w3.org/XML/1998/namespace", "space", "xml:space"],
    ];
    for (const source of sources) {
      const expected = new DOMParser().parseFromString(source, "application/xml");
      expect(expected.getElementsByTagName("parsererror")).toHaveLength(0);
      expect(outline(parseXml(source).documentElement, names)).toEqual(outline(expected.documentElement, names));
    }
  });

  it("refuses XML that isn't well-formed", () => {
    const damaged = [
      "",
      "just text",
      "<a><b></a>",
      "<a>",
      "<a></a><b></b>",
      "<a></a>trailing",
      "<w:a/>",
      '<a x="1" x="2"/>',
      '<a x="1"y="2"/>',
      "<a x=1/>",
      '<a x="<"/>',
      "<a>&nbsp;</a>",
      "<a>&amp</a>",
      "<a>&#xZZ;</a>",
      "<a><!-- open</a>",
      "<a><![CDATA[ open</a>",
    ];
    for (const source of damaged) {
      expect(() => parseXml(source), source).toThrow("The document's XML is damaged.");
      if (source) expect(new DOMParser().parseFromString(source, "application/xml").getElementsByTagName("parsererror").length, source).toBeGreaterThan(0);
    }
  });

  it("never expands entities a file declares, unlike DOMParser", () => {
    expect(() => parseXml('<!DOCTYPE a [<!ENTITY e "boom">]><a>&e;</a>')).toThrow("The document's XML is damaged.");
  });
});
