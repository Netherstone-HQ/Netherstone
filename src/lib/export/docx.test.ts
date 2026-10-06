// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { fixtureDocument, fixtureImages } from "./__fixtures__/fixture";
import { latexToOmml, renderDocx } from "./docx";
import type { ExportOptions } from "./options";

const OPTIONS: ExportOptions = {
  format: "docx",
  typeface: "newsreader",
  textSize: "default",
  pageSize: "a4",
  margins: "normal",
  pageNumbers: true,
  theme: "light",
};

describe("Word export", () => {
  const doc = fixtureDocument();
  const images = fixtureImages(doc);
  function render(options: Partial<ExportOptions> = {}) {
    return renderDocx(doc, { images, options: { ...OPTIONS, ...options }, toPng: async () => null });
  }

  it("writes real Word structure", async () => {
    const zip = await JSZip.loadAsync(await render());
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
    expect(xml).toMatch(/<w:bookmarkStart w:name="h_field_notes_on_export" w:id="\d+"\/>/);
    expect(xml).toContain("<w:numPr>");
    expect(xml).toContain("<w14:checkbox>");
    expect(xml).toContain("<m:oMath");
    expect(xml).toContain("<m:oMathPara");
    expect(xml).not.toContain("<undefined");
    // Every part must parse as XML, or Word refuses the file.
    for (const name of Object.keys(zip.files).filter((file) => /\.(xml|rels)$/.test(file))) {
      const part = new DOMParser().parseFromString(await zip.file(name)!.async("string"), "application/xml");
      expect(part.getElementsByTagName("parsererror"), name).toHaveLength(0);
    }
    expect(xml).toContain("<w:tblHeader/>");
    expect(xml).toContain('<w:pStyle w:val="Quote"/>');
    expect(xml).toContain("<pic:pic");
    expect(xml).toContain('w:fill="F1EEE9"');

    const footer = await zip.file("word/footer1.xml")!.async("string");
    expect(footer).toContain("NUMPAGES");
  });

  it("names its fonts with stand-ins for computers without them", async () => {
    const zip = await JSZip.loadAsync(await render());
    const table = await zip.file("word/fontTable.xml")!.async("string");
    expect(table).toContain('<w:font w:name="Newsreader"><w:altName w:val="Georgia"/>');
    expect(table).toContain('<w:font w:name="Geist"><w:altName w:val="Arial"/>');
    expect(Object.keys(zip.files).some((name) => name.endsWith(".odttf"))).toBe(false);

    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toContain('w:ascii="Newsreader"');
    const sans = await JSZip.loadAsync(await render({ typeface: "geist" }));
    expect(await sans.file("word/styles.xml")!.async("string")).not.toContain('w:ascii="Newsreader"');

    if (process.env.EXPORT_FIXTURE_OUT) {
      fs.writeFileSync(path.join(process.env.EXPORT_FIXTURE_OUT, "everything.docx"), await render());
    }
  });

  it("uses the chosen paper and margins", async () => {
    const zip = await JSZip.loadAsync(await render({ pageSize: "letter", margins: "narrow", pageNumbers: false }));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toMatch(/<w:pgSz w:w="12240" w:h="15840"/);
    expect(xml).toMatch(/w:left="794"/);
    expect(Object.keys(zip.files).some((name) => name.includes("footer"))).toBe(false);
  });

  it("turns LaTeX into editable equations", () => {
    expect(latexToOmml(String.raw`\frac{a}{b}`)).toContain("<m:f>");
    expect(latexToOmml(String.raw`\mathbb{R}`)).toContain("ℝ");
    expect(latexToOmml(String.raw`\frac{`)).toBeNull();
  });
});
