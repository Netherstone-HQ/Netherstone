import { ImportError, type Importer } from "../../types";
import { DocxReader, resolvePart, type Relationship } from "./reader";
import { Numbering, Styles } from "./styles";
import { attr, child, elements, is, parseXml } from "./xml";

const RELATIONSHIP_TYPES = {
  document: /\/officeDocument$/,
  styles: /\/styles$/,
  numbering: /\/numbering$/,
  footnotes: /\/footnotes$/,
  endnotes: /\/endnotes$/,
};

/**
 * Word documents (.docx), read straight from their XML: headings, text
 * formatting and colours, alignment and indents, numbered, bulleted and
 * to-do lists, tables with merged and shaded cells, pictures, links,
 * equations, footnotes and the table of contents.
 */
export const docxImporter: Importer = {
  label: "Word",
  extensions: ["docx", "docm", "dotx"],
  async convert(file, context) {
    const { default: JSZip } = await import("jszip");
    let zip;
    try {
      zip = await JSZip.loadAsync(await file.read());
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
    const document = await readXml(documentPath);
    const body = child(document?.documentElement, "w", "body");
    if (!body) throw new ImportError("This Word document has no text in it.");

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

    const notes = new Map<string, Element>();
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
        name: file.name.replace(/\.[^.]+$/, ""),
      },
      context,
    );
    return { nodes: await reader.read(body) };
  },
};
