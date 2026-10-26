import JSZip from "jszip";

import { ImportError, type PlateNode } from "../../types";
import { DocxReader, resolvePart, type ReaderContext, type Relationship } from "./reader";
import { Numbering, Styles } from "./styles";
import { attr, elements, is } from "./xml";
import { checkXml, parseXml, XmlStream, type XmlElement } from "./xml-tree";

const RELATIONSHIP_TYPES = {
  document: /\/officeDocument$/,
  styles: /\/styles$/,
  numbering: /\/numbering$/,
  footnotes: /\/footnotes$/,
  endnotes: /\/endnotes$/,
};

const NO_TEXT = "This Word document has no text in it.";

/** Reads a Word package, `name` being its file name without extension. */
export async function readWordPackage(bytes: Uint8Array, name: string, context: ReaderContext): Promise<PlateNode[]> {
  let zip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new ImportError("This isn't a Word document Netherstone can open. If it has a password, remove it in Word first.");
  }

  const readXml = async (path: string) => {
    const entry = zip.file(path);
    return entry ? parseXml(await entry.async("string")) : null;
  };
  const relationshipsOf = async (part: string) => {
    const slash = part.lastIndexOf("/");
    const rels = await readXml(`${part.slice(0, slash + 1)}_rels/${part.slice(slash + 1)}.rels`);
    const map = new Map<string, Relationship & { type: string }>();
    for (const element of elements(rels?.documentElement)) {
      if (!is(element, "pr", "Relationship")) continue;
      map.set(element.getAttribute("Id") ?? "", {
        target: element.getAttribute("Target") ?? "",
        type: element.getAttribute("Type") ?? "",
        external: element.getAttribute("TargetMode") === "External",
      });
    }
    return map;
  };

  const packageRelationships = await relationshipsOf("");
  const main = [...packageRelationships.values()].find((rel) => RELATIONSHIP_TYPES.document.test(rel.type));
  const documentPath = main ? resolvePart("", main.target) : "word/document.xml";
  // The main document is read a block at a time; checking it first keeps a
  // damaged one from storing pictures before it fails.
  const source = await zip.file(documentPath)?.async("string");
  if (source === undefined) throw new ImportError(NO_TEXT);
  checkXml(source);
  let hasBody = false;
  const stream = new XmlStream(source, (element, depth) => {
    if (hasBody || depth !== 1 || !is(element, "w", "body")) return false;
    hasBody = true;
    return true;
  });
  const first = stream.next();
  if (!hasBody) throw new ImportError(NO_TEXT);

  const base = documentPath.slice(0, documentPath.lastIndexOf("/") + 1);
  const relationships = await relationshipsOf(documentPath);
  const partOf = (type: RegExp) => {
    const rel = [...relationships.values()].find((candidate) => type.test(candidate.type));
    return rel ? resolvePart(base, rel.target) : null;
  };
  const load = async (type: RegExp) => {
    const path = partOf(type);
    return path ? readXml(path) : null;
  };

  const notes = new Map<string, XmlElement>();
  for (const [prefix, type] of [["footnote", RELATIONSHIP_TYPES.footnotes], ["endnote", RELATIONSHIP_TYPES.endnotes]] as const) {
    const notesDocument = await load(type);
    for (const note of elements(notesDocument?.documentElement)) {
      const id = attr(note, "w", "id");
      if (id) notes.set(`${prefix}:${id}`, note);
    }
  }

  const reader = new DocxReader(
    {
      zip,
      base,
      styles: new Styles(await load(RELATIONSHIP_TYPES.styles)),
      numbering: new Numbering(await load(RELATIONSHIP_TYPES.numbering)),
      relationships,
      notes,
      name,
    },
    context,
  );
  return reader.read(blocksOf(first, stream));
}

function* blocksOf(first: XmlElement | null, stream: XmlStream) {
  for (let block = first; block; block = stream.next()) yield block;
}
