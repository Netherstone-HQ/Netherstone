// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { loadMarkdown } from "@/test/markdown";

import { fixtureDocument, fixtureImages } from "./__fixtures__/fixture";
import { buildExportDocument } from "./build";
import { latexToOmml, renderDocx, type MeasureText } from "./docx";
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
    // Header rows are shaded by the table style, not by their cells.
    expect(xml).toContain('<w:tblStyle w:val="ShardTable"/>');
    expect(xml).toMatch(/<w:tblLook [^>]*w:firstRow="(1|true)"/);
    expect(xml.match(/<w:tblHeader\/>.*?<\/w:tr>/)![0]).not.toContain("<w:shd ");
    const styles = await zip.file("word/styles.xml")!.async("string");
    expect(styles).toMatch(/<w:style w:type="table" w:styleId="ShardTable">.*<w:tblStylePr w:type="firstRow"><w:tcPr><w:shd [^>]*w:fill="F7F5F2"/);
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

  it("keeps everything after a sum or integral in its body, up to the next relation", () => {
    const sum = latexToOmml(String.raw`\sum_{i=1}^{n} i = \frac{n(n+1)}{2}`)!;
    const font = '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>';
    expect(sum).toContain(
      `<m:e><m:r>${font}<m:t xml:space="preserve">i</m:t></m:r></m:e></m:nary><m:r>${font}<m:t xml:space="preserve">=</m:t>`,
    );
    const integral = latexToOmml(String.raw`\int_0^1 x^2\,dx + 1`)!;
    expect(integral).toMatch(/<m:e><m:sSup>.*dx<\/m:t><\/m:r><\/m:e><\/m:nary><m:r><w:rPr>.*?<\/w:rPr><m:t xml:space="preserve">\+1/);
  });

  it("writes upright letters with the math properties first, as the format requires", () => {
    const integral = latexToOmml(String.raw`\int_{-\infty}^{\infty} \mathrm{d}x`)!;
    expect(integral).toContain('<m:r><m:rPr><m:sty m:val="p"/></m:rPr><w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr><m:t xml:space="preserve">∞</m:t>');
    expect(integral).not.toMatch(/<w:rPr\/>|<m:nor\/>/);
  });

  it("puts the limits of a displayed sum under and over it", () => {
    expect(latexToOmml(String.raw`\sum_{i=1}^{n} i`, true)).toContain('<m:limLoc m:val="undOvr"/>');
    expect(latexToOmml(String.raw`\sum_{i=1}^{n} i`)).toContain('<m:limLoc m:val="subSup"/>');
  });

  it("writes equations the way Word does", async () => {
    const sum = latexToOmml(String.raw`\sum_i x_i \, y_i`)!;
    expect(sum).toContain('<m:subHide m:val="0"/><m:supHide m:val="1"/>');
    expect(sum).not.toMatch(/m:val="(on|off)"|<m:t[^>]*><\/m:t>/);
    expect(sum).not.toMatch(/<m:r><m:t/);

    const zip = await JSZip.loadAsync(
      await renderDocx(fixtureDocument(), { images: new Map(), options: OPTIONS, toPng: async () => null }),
    );
    expect(await zip.file("word/settings.xml")!.async("string")).toContain('<m:mathPr><m:mathFont m:val="Cambria Math"/>');
    expect(await zip.file("word/fontTable.xml")!.async("string")).toContain('<w:font w:name="Cambria Math">');
  });

  describe("tables wider than the page", () => {
    const header = ["Setup", "Report", "Accurate", "Specific", "Groups", "Coverage", "Strategies", "Plan", "Materials", "Finish", "Score"];
    const markdown = [
      `| ${header.join(" | ")} |`,
      `|${" --- |".repeat(header.length)}`,
      `| Packets V5 | 9637 | 43 | 26 | 44 | 65 | 91 | 88 | 92 | 98 | **69** |`,
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| Small | 1 |",
    ].join("\n");
    const doc = buildExportDocument(loadMarkdown(markdown) as unknown[], { fileName: "wide", locale: "en-US" });
    // Every character as wide as its size; bold a little wider.
    const measureText: MeasureText = (text, style) => text.length * style.size * (style.bold ? 0.6 : 0.5);
    const options: ExportOptions = { ...OPTIONS, typeface: "geist", textSize: "large" };

    async function tables(measure?: MeasureText) {
      const zip = await JSZip.loadAsync(await renderDocx(doc, { images: new Map(), options, toPng: async () => null, measureText: measure }));
      const xml = await zip.file("word/document.xml")!.async("string");
      const styles = await zip.file("word/styles.xml")!.async("string");
      const found = [...xml.matchAll(/<w:tbl>.*?<\/w:tbl>/g)].map(([table]) => ({
        width: Number(table.match(/<w:tblW w:type="dxa" w:w="(\d+)"/)![1]),
        grid: [...table.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].map((match) => Number(match[1])),
        styles: new Set([...table.matchAll(/<w:pStyle w:val="([^"]+)"\/>/g)].map((match) => match[1])),
        padding: Number(table.match(/<w:tcMar>.*?<w:left w:type="dxa" w:w="(\d+)"/)![1]),
      }));
      return { found, styles };
    }

    it("shrinks the text just enough that no word breaks, and fills the page width", async () => {
      const { found, styles } = await tables(measureText);
      const [wide, narrow] = found;
      expect(wide.grid.reduce((sum, value) => sum + value, 0)).toBe(wide.width);
      // Large text is 12 pt, and table headers 10.8 pt; both shrink, to whole half points.
      const ids = [...wide.styles].sort();
      expect(ids).toEqual([expect.stringMatching(/^NormalAt\d+$/), expect.stringMatching(/^TableHeaderAt\d+$/)]);
      const [body, header] = ids.map((id) => Number(id.match(/\d+$/)![0]) / 2);
      expect(body).toBeLessThan(12);
      expect(header).toBeLessThan(10.8);
      expect(styles).toContain(`<w:style w:type="paragraph" w:styleId="${ids[1]}"><w:name w:val="Table Header ${header} pt"/><w:basedOn w:val="TableHeader"/>`);
      expect(wide.padding).toBeLessThan(140);

      // Each column holds its longest word at the shrunk size, with its padding and rules.
      const rules = 2 * Math.ceil((5 / 8) * 20);
      const words = [["Setup", "Packets"], ["Report", "9637"], ["Accurate"], ["Specific"], ["Groups"], ["Coverage"], ["Strategies"], ["Plan"], ["Materials"], ["Finish"], ["Score"]];
      wide.grid.forEach((column, index) => {
        const longest = Math.max(
          header * 0.6 * words[index][0].length,
          ...words[index].slice(1).map((word) => body * 0.5 * word.length),
        );
        expect(column - 2 * wide.padding - rules).toBeGreaterThanOrEqual(Math.round(longest * 20));
      });

      // A table that fits keeps its size and even columns.
      expect(narrow.grid).toEqual([narrow.width / 2, narrow.width / 2]);
      expect(narrow.styles).toEqual(new Set(["TableHeader"]));
      expect(narrow.padding).toBe(140);
    });

    it("keeps the writer's columns where text can't be measured", async () => {
      const { found, styles } = await tables();
      expect(found[0].styles).toEqual(new Set(["TableHeader"]));
      expect(new Set(found[0].grid).size).toBeLessThanOrEqual(2);
      expect(styles).not.toMatch(/styleId="\w+At\d+"/);
    });
  });
});
