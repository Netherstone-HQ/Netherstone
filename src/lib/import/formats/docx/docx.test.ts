// @vitest-environment jsdom
import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fixtureDocument, fixtureImages } from "@/lib/export/__fixtures__/fixture";
import { renderDocx } from "@/lib/export/docx";
import { memoryImport } from "@/test/import";
import { DocxWorker, useDocxWorker } from "@/test/docx-worker";

useDocxWorker();

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A Word file with just a body, styles and numbering, as Word itself would write them. */
async function wordFile(
  body: string,
  extra: { styles?: string; numbering?: string; rels?: string; types?: string; media?: Record<string, Uint8Array>; parts?: Record<string, string> } = {},
) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${extra.types ?? ""}</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${extra.rels ?? ""}</Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0"?><w:styles ${W}>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
      ${extra.styles ?? ""}
    </w:styles>`,
  );
  zip.file("word/numbering.xml", `<?xml version="1.0"?><w:numbering ${W}>${extra.numbering ?? ""}</w:numbering>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  for (const [name, bytes] of Object.entries(extra.media ?? {})) zip.file(`word/media/${name}`, bytes);
  for (const [name, xml] of Object.entries(extra.parts ?? {})) zip.file(`word/${name}`, xml);
  return zip.generateAsync({ type: "uint8array" });
}

const run = (text: string, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (content: string, props = "") => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ""}${content}</w:p>`;
const picture = (id: string) =>
  `<w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1905000" cy="952500"/><wp:docPr id="1" name="Picture" descr="A chart"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><a:blip r:embed="${id}"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
const pictureRel = (id: string, target: string) =>
  `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${target}"/>`;
/** Bytes that don't compress, to make a Word file as big as they are. */
function noise(size: number) {
  const bytes = new Uint8Array(size);
  for (let at = 0; at < size; at += 65_536) crypto.getRandomValues(bytes.subarray(at, at + 65_536));
  return bytes;
}
const cell = (content: string, props = "") => `<w:tc>${props ? `<w:tcPr>${props}</w:tcPr>` : ""}${para(content)}</w:tc>`;

async function importWord(bytes: Uint8Array) {
  const vault = memoryImport({ "Doc.docx": bytes });
  const report = await vault.run();
  expect(report.failed).toEqual([]);
  return { markdown: vault.shards.get("/vault/Doc.md")!, vault, report };
}

describe("Word import", () => {
  it("brings back what Netherstone's own Word export wrote", async () => {
    const doc = fixtureDocument();
    const exported = await renderDocx(doc, {
      images: fixtureImages(doc),
      options: { format: "docx", typeface: "newsreader", textSize: "default", pageSize: "a4", margins: "normal", pageNumbers: true, theme: "light" },
      toPng: async () => null,
    });
    const { markdown, vault } = await importWord(exported);

    expect(markdown).toMatch(/^# Field notes on export\n/);
    expect(markdown).toContain("**bold**, _italic_, <u>underlined</u>, ~~struck~~ and `inline code`");
    expect(markdown).toContain("H<sub>2</sub>O and E = mc<sup>2</sup>");
    expect(markdown).toContain("[the release notes](https://example.com/notes)");
    expect(markdown).toContain("<toc />");
    expect(markdown).toContain("- Second point with a nested list\n  - Nested once\n    - Nested twice");
    expect(markdown).toContain("2. Write the shard\n   1. Draft\n   2. Revise\n3. Export it");
    expect(markdown).toContain("- [ ] Check every page");
    expect(markdown).toContain("> [!tip]\n> Callouts keep");
    expect(markdown).toContain("```typescript\n// Greets someone by name.\nexport function greet(name: string): string {\n  const message");
    expect(markdown).toContain("$\\int_{- \\infty}^{\\infty} e^{- x^{2}}dx=\\sqrt{\\pi}$");
    // The header shade is the table's look, not a colour on its cells.
    expect(markdown).not.toMatch(/<!-- netherstone:[^>]*\bfill\b/);
    expect(markdown).toContain("| PDF        | System webview | The app's own, **shared** |");
    expect(markdown).toContain('<img src="_attachments/Doc 1.png" width="480" />');
    expect(markdown).toContain("Привет, 日本語のテキスト, and an emoji 🎉.");
    expect(vault.attachments.size).toBe(1);
  });

  it("reads merged cells, nested numbering and links", async () => {
    const numbering = `
      <w:abstractNum w:abstractNumId="0">
        <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>
        <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
      </w:abstractNum>
      <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>`;
    const list = (text: string, level: number) => para(run(text), `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr>`);
    const body = [
      para(run("Plan"), '<w:pStyle w:val="Heading1"/>'),
      para(`${run("Read ")}<w:hyperlink r:id="rLink">${run("the site")}</w:hyperlink>${run(" now.", "<w:i/>")}`, '<w:jc w:val="center"/>'),
      list("First", 0),
      list("Detail", 1),
      list("Second", 0),
      `<w:tbl><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
        <w:tr>${cell(run("Both"), '<w:gridSpan w:val="2"/><w:shd w:val="clear" w:fill="FFEEDD"/>')}</w:tr>
        <w:tr>${cell(run("Tall"), '<w:vMerge w:val="restart"/>')}${cell(run("x"))}</w:tr>
        <w:tr>${cell("", "<w:vMerge/>")}${cell(run("y"))}</w:tr>
      </w:tbl>`,
    ].join("");
    const bytes = await wordFile(body, {
      numbering,
      rels: '<Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>',
    });
    const { markdown } = await importWord(bytes);

    expect(markdown).toContain("# Plan");
    expect(markdown).toContain('<div align="center">\n\nRead [the site](https://example.com) _now\\._\n\n</div>');
    expect(markdown).toContain("1. First\n   - Detail\n2. Second");
    expect(markdown).toContain("<!-- netherstone: widths 133 133; merge A1:B1 A2:A3; fill A1=#ffeedd -->");
    expect(markdown).toContain("| Tall | x |\n|     | y |");
  });

  it("keeps tracked insertions and leaves out deletions and hidden text", async () => {
    const body = [
      para(`${run("Kept ")}<w:ins w:id="1" w:author="A">${run("added ")}</w:ins><w:del w:id="2" w:author="A"><w:r><w:delText>removed </w:delText></w:r></w:del>${run("end.")}`),
      para(`${run("Shown")}${run(" secret", "<w:vanish/>")}`),
      `<w:ins w:id="3" w:author="A">${para(run("A whole inserted paragraph"))}</w:ins>`,
    ].join("");
    const { markdown } = await importWord(await wordFile(body));

    expect(markdown).toContain("Kept added end.");
    expect(markdown).toContain("Shown");
    expect(markdown).toContain("A whole inserted paragraph");
    expect(markdown).not.toContain("removed");
    expect(markdown).not.toContain("secret");
  });

  it("reads footnotes, checkboxes, field links and text boxes", async () => {
    const field = (instruction: string, result: string) =>
      `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instruction}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${run(result)}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
    const checkbox = (checked: boolean) =>
      `<w:sdt xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:sdtPr><w14:checkbox><w14:checked w14:val="${checked ? 1 : 0}"/></w14:checkbox></w:sdtPr><w:sdtContent>${run(checked ? "☒" : "☐")}</w:sdtContent></w:sdt>`;
    const body = [
      para(`${run("A claim")}<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="2"/></w:r>${run(".")}`),
      para(`${checkbox(true)}${run("Done")}`),
      para(`${checkbox(false)}${run("Not yet")}`),
      para(`${run("See ")}${field(' HYPERLINK "https://example.com/field" ', "the page")}${run(".")}`),
      para(
        `<w:r><w:drawing><wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1905000" cy="952500"/><wp:docPr id="2" name="Text Box"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:txbx><w:txbxContent>${para(run("Inside the box"))}</w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`,
      ),
    ].join("");
    const footnotes = `<?xml version="1.0"?><w:footnotes ${W}>
      <w:footnote w:type="separator" w:id="-1">${para("<w:r><w:separator/></w:r>")}</w:footnote>
      <w:footnote w:id="2">${para(`<w:r><w:footnoteRef/></w:r>${run(" Where it comes from.")}`)}</w:footnote>
    </w:footnotes>`;
    const bytes = await wordFile(body, {
      rels: '<Relationship Id="rNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>',
      parts: { "footnotes.xml": footnotes },
    });
    const { markdown } = await importWord(bytes);
    expect(markdown).toContain("A claim<sup>1</sup>.");
    expect(markdown).toContain("- [x] Done\n- [ ] Not yet");
    expect(markdown).toContain("See [the page](https://example.com/field).");
    expect(markdown).toContain("Inside the box");
    expect(markdown).toMatch(/---\n\n1\. Where it comes from\.\n*$/);
  });

  it("explains files that aren't Word documents", async () => {
    const vault = memoryImport({ "Fake.docx": "not a zip" });
    const report = await vault.run();
    expect(report.failed[0].error).toMatch(/Word/);
  });
});

describe("Word import in its worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks the window for links, pictures and warnings, in document order", async () => {
    const linkRel = '<Relationship Id="rOther" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="Other.docx" TargetMode="External"/>';
    const bytes = await wordFile(
      [
        para(`${run("See ")}<w:hyperlink r:id="rOther">${run("the other file")}</w:hyperlink>${run(".")}`),
        para(picture("rPic")),
        para(picture("rPic")),
        para(picture("rOld")),
        para(picture("rSecond")),
      ].join(""),
      {
        rels: linkRel + pictureRel("rPic", "media/image1.png") + pictureRel("rOld", "media/image2.emf") + pictureRel("rSecond", "media/image3.png"),
        media: { "image1.png": new Uint8Array([1, 2, 3]), "image2.emf": new Uint8Array([4]), "image3.png": new Uint8Array([5, 6]) },
      },
    );
    const other = await wordFile(para(run("Other")));
    const vault = memoryImport({ "Doc.docx": bytes, "Other.docx": other });
    const report = await vault.run();

    expect(report.failed).toEqual([]);
    const markdown = vault.shards.get("/vault/Doc.md")!;
    expect(markdown).toContain("See [the other file](Other.md).");
    // One picture stored once, however often it's shown.
    expect(markdown.match(/_attachments\/Doc 1\.png/g)).toHaveLength(2);
    expect(markdown).toContain("_attachments/Doc 2.png");
    expect([...vault.attachments.values()].map((stored) => [...stored])).toEqual([[1, 2, 3], [5, 6]]);
    expect(report.created.find((shard) => shard.source === "Doc.docx")!.warnings).toEqual([
      "1 picture is in an old Windows format (EMF or WMF) and was left out.",
    ]);
  });

  it("names pictures by the type the file declares for them", async () => {
    const bytes = await wordFile([para(picture("rPng")), para(picture("rWmf")), para(picture("rSvg")), para(picture("rPlain"))].join(""), {
      rels:
        pictureRel("rPng", "media/image1.bin") +
        pictureRel("rWmf", "media/image2.bin") +
        pictureRel("rSvg", "media/image3.bin") +
        pictureRel("rPlain", "media/image4.gif"),
      types:
        '<Default Extension="BIN" ContentType="image/png"/>' +
        '<Override PartName="/word/media/IMAGE2.bin" ContentType="image/x-wmf"/>' +
        '<Override PartName="/word/media/image3.bin" ContentType="image/svg+xml"/>',
      media: { "image1.bin": new Uint8Array([1]), "image2.bin": new Uint8Array([2]), "image3.bin": new Uint8Array([3]), "image4.gif": new Uint8Array([4]) },
    });
    const vault = memoryImport({ "Doc.docx": bytes });
    const report = await vault.run();

    expect(report.failed).toEqual([]);
    const markdown = vault.shards.get("/vault/Doc.md")!;
    // The Default for .bin, an Override per part, and the part's own extension when nothing is declared.
    expect(markdown).toContain("_attachments/Doc 1.png");
    expect(markdown).toContain("_attachments/Doc 2.svg");
    expect(markdown).toContain("_attachments/Doc 3.gif");
    expect(markdown).not.toContain(".bin");
    expect(report.created[0].warnings).toEqual(["1 picture is in an old Windows format (EMF or WMF) and was left out."]);
  });

  it("reads many small files one after another in as many workers as it reads at once", async () => {
    const readers = new Set<DocxWorker>();
    const send = DocxWorker.prototype.postMessage;
    vi.spyOn(DocxWorker.prototype, "postMessage").mockImplementation(function (this: DocxWorker, message) {
      if (message.type === "read") readers.add(this);
      send.call(this, message);
    });
    const files: Record<string, Uint8Array> = {};
    for (let n = 1; n <= 25; n += 1) files[`Doc ${n}.docx`] = await wordFile(para(run(`File ${n}`), '<w:pStyle w:val="Heading1"/>'));
    const vault = memoryImport(files);
    const report = await vault.run();

    expect(report.failed).toEqual([]);
    expect(report.created).toHaveLength(25);
    for (let n = 1; n <= 25; n += 1) expect(vault.shards.get(`/vault/Doc ${n}.md`)).toBe(`# File ${n}\n`);
    expect(readers.size).toBe(2);
    // They wait a moment for more files.
    expect(DocxWorker.running.size).toBe(2);
  });

  it("gives each big file a fresh worker", async () => {
    const readers = new Set<DocxWorker>();
    const send = DocxWorker.prototype.postMessage;
    vi.spyOn(DocxWorker.prototype, "postMessage").mockImplementation(function (this: DocxWorker, message) {
      if (message.type === "read") readers.add(this);
      send.call(this, message);
    });
    const big = () => wordFile(para(run("Big")), { media: { "unused.png": noise(1_100_000) } });
    const vault = memoryImport({ "One.docx": await big(), "Two.docx": await big(), "Three.docx": await wordFile(para(run("Small"))) });
    const report = await vault.run();

    expect(report.failed).toEqual([]);
    // One for each big file, and one more for the file after them.
    expect(readers.size).toBe(3);
  });

  it("stops the worker as soon as the import is cancelled", async () => {
    // Every link is a round trip to the window, so reading takes a while.
    const links = Array.from({ length: 400 }, (_, n) => `<Relationship Id="r${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="Other.docx" TargetMode="External"/>`);
    const body = links.map((_, n) => para(`<w:hyperlink r:id="r${n}">${run(`Link ${n}`)}</w:hyperlink>`)).join("");
    const long = () => wordFile(body, { rels: links.join("") });
    const vault = memoryImport({ "Long.docx": await long(), "Long 2.docx": await long(), "Other.docx": await wordFile(para(run("Other"))) });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 150);
    const report = await vault.run({ signal: controller.signal });

    expect(report.cancelled).toBe(true);
    expect(report.created).toEqual([]);
    expect(vault.shards.size).toBe(0);
    expect(DocxWorker.running.size).toBe(0);
  });

  it("puts headings under a Title wherever the Title is", async () => {
    const { markdown } = await importWord(
      await wordFile(
        para(run("Before"), '<w:pStyle w:val="Heading1"/>') +
          `<w:tbl><w:tr>${cell(run("Cell heading"), "")}<w:tc>${para(run("Right"))}</w:tc></w:tr></w:tbl>` +
          para(run("The title"), '<w:pStyle w:val="Title"/>') +
          para(run("After"), '<w:pStyle w:val="Heading1"/>'),
        { styles: '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>' },
      ),
    );
    expect(markdown).toContain("## Before\n");
    expect(markdown).toContain("# The title\n");
    expect(markdown).toContain("## After");
  });

  it("turns three or more links to headings in a row into a contents list", async () => {
    const entry = (label: string) => para(`<w:hyperlink w:anchor="_${label}">${run(label)}</w:hyperlink>`);
    const { markdown } = await importWord(
      await wordFile(entry("One") + entry("Two") + entry("Three") + para(run("Text")) + entry("Four") + entry("Five") + para(run("End"))),
    );
    expect(markdown).toBe("<toc />\n\nText\n\nFour\n\nFive\n\nEnd\n");
  });

  it("explains damaged XML, before storing any picture", async () => {
    const vault = memoryImport({
      "Doc.docx": await wordFile(para(picture("rPic")) + "<w:p><w:r><w:t>Unclosed</w:r></w:p>", {
        rels: pictureRel("rPic", "media/image1.png"),
        media: { "image1.png": new Uint8Array([1]) },
      }),
    });
    const report = await vault.run();
    expect(report.failed).toEqual([{ source: "Doc.docx", error: "The document's XML is damaged." }]);
    expect(vault.attachments.size).toBe(0);
  });

  it("explains a document without a body", async () => {
    const zip = new JSZip();
    zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}/>`);
    const vault = memoryImport({ "Doc.docx": await zip.generateAsync({ type: "uint8array" }) });
    const report = await vault.run();
    expect(report.failed).toEqual([{ source: "Doc.docx", error: "This Word document has no text in it." }]);
  });

  it("fails the file when a picture can't be stored, and carries on with the rest", async () => {
    const vault = memoryImport({
      "Doc.docx": await wordFile(para(picture("rPic")), { rels: pictureRel("rPic", "media/image1.png"), media: { "image1.png": new Uint8Array([1]) } }),
      "Next.docx": await wordFile(para(run("Next"))),
    });
    vault.io.saveAttachment = async () => {
      throw new Error("The disk is full.");
    };
    const report = await vault.run();
    expect(report.failed).toEqual([{ source: "Doc.docx", error: "The disk is full." }]);
    expect(vault.shards.get("/vault/Next.md")).toBe("Next\n");
  });

  it("reports a worker that stops on its own", async () => {
    vi.spyOn(DocxWorker.prototype, "postMessage").mockImplementation(function (this: DocxWorker) {
      setTimeout(() => this.onerror?.({ message: "" } as ErrorEvent));
    });
    const vault = memoryImport({ "Doc.docx": await wordFile(para(run("Text"))), "Next.docx": await wordFile(para(run("Next"))) });
    const report = await vault.run();
    expect(report.failed.map((failure) => failure.error)).toEqual([
      "Something went wrong reading this file.",
      "Something went wrong reading this file.",
    ]);
    // A worker that stopped isn't given the next file.
    expect(DocxWorker.running.size).toBe(0);
  });
});
