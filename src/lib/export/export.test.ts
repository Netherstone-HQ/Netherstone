import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ROOT, fixtureDocument, fixtureImages, testPng } from "./__fixtures__/fixture";
import { measureSvg, resolveImagePath, sniffImageMime } from "./assets";
import { buildExportDocument, formatDate, normalizeColor } from "./build";
import { cssString, previewLook, renderHtmlBody, renderHtmlDocument, renderPreviewDocument, selectFontFaces } from "./html";
import type { Block } from "./model";
import { defaultExportOptions, loadExportOptions, saveExportOptions, type ExportOptions } from "./options";
import { getDefaultPageSize } from "./theme";

const BASE_OPTIONS: ExportOptions = {
  format: "pdf",
  typeface: "newsreader",
  textSize: "default",
  pageSize: "a4",
  margins: "normal",
  pageNumbers: true,
  theme: "light",
};

function find<T extends Block["type"]>(blocks: Block[], type: T): Extract<Block, { type: T }>[] {
  const found: Block[] = [];
  const visit = (list: Block[]) => {
    for (const block of list) {
      if (block.type === type) found.push(block);
      if ("children" in block && Array.isArray(block.children)) visit(block.children);
      if (block.type === "columns") block.columns.forEach(visit);
      if (block.type === "list") block.items.forEach((item) => visit(item.children));
    }
  };
  visit(blocks);
  return found as Extract<Block, { type: T }>[];
}

describe("export model", () => {
  const doc = fixtureDocument();

  it("takes the title from the first heading", () => {
    expect(doc.title).toBe("Field notes on export");
    expect(buildExportDocument([], { fileName: "Untitled shard" }).title).toBe("Untitled shard");
  });

  it("nests lists and numbers ordered items", () => {
    const [bullets, ordered, todos] = find(doc.blocks, "list").filter((list) =>
      doc.blocks.includes(list),
    );
    expect(bullets.kind).toBe("bullet");
    expect(bullets.items).toHaveLength(3);
    const nested = bullets.items[1].children[0];
    expect(nested.type === "list" && nested.items[0].children[0].type).toBe("list");

    expect(ordered.kind).toBe("ordered");
    expect(ordered.items.map((item) => item.number)).toEqual([1, 2, 3]);
    const sublist = ordered.items[1].children[0];
    expect(sublist.type === "list" && sublist.items.map((item) => item.number)).toEqual([1, 2]);

    expect(todos.kind).toBe("todo");
    expect(todos.items.map((item) => item.checked)).toEqual([true, false]);
  });

  it("restarts numbering after a paragraph", () => {
    const value = [
      { type: "p", indent: 1, listStyleType: "decimal", children: [{ text: "a" }] },
      { type: "p", indent: 1, listStyleType: "decimal", listStart: 2, children: [{ text: "b" }] },
      { type: "p", children: [{ text: "break" }] },
      { type: "p", indent: 1, listStyleType: "decimal", children: [{ text: "c" }] },
    ];
    const lists = buildExportDocument(value, { fileName: "x" }).blocks.filter((block) => block.type === "list");
    expect(lists).toHaveLength(2);
    expect(lists[1].type === "list" && lists[1].items[0].number).toBe(1);
  });

  it("keeps continuation paragraphs inside their list item", () => {
    const value = [
      { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "item" }] },
      { type: "p", indent: 1, children: [{ text: "more about the item" }] },
      { type: "p", children: [{ text: "after" }] },
    ];
    const [list, after] = buildExportDocument(value, { fileName: "x" }).blocks;
    expect(list.type === "list" && list.items[0].children[0]).toMatchObject({ type: "paragraph" });
    expect(after).toMatchObject({ type: "paragraph" });
  });

  it("gives toggles the indented blocks that follow them", () => {
    const value = [
      { type: "toggle", children: [{ text: "Details" }] },
      { type: "p", indent: 1, children: [{ text: "hidden" }] },
      { type: "p", children: [{ text: "visible" }] },
    ];
    const [toggle, paragraph] = buildExportDocument(value, { fileName: "x" }).blocks;
    expect(toggle).toMatchObject({ type: "toggle", children: [{ type: "paragraph" }] });
    expect(paragraph).toMatchObject({ type: "paragraph" });
  });

  it("reads inline marks, mentions, dates and math", () => {
    const first = doc.blocks[1];
    expect(first.type).toBe("paragraph");
    const inlines = first.type === "paragraph" ? first.content : [];
    expect(inlines).toContainEqual({ type: "text", text: "bold", marks: { bold: true } });
    expect(inlines).toContainEqual({ type: "mention", label: "Other shard" });
    expect(inlines).toContainEqual({ type: "date", text: "October 6, 2026" });
    expect(inlines.some((inline) => inline.type === "link" && inline.url === "https://example.com/notes")).toBe(true);
    expect(doc.hasMath).toBe(true);
  });

  it("fills the table of contents with every heading", () => {
    const [toc] = find(doc.blocks, "toc");
    expect(toc.entries[0]).toEqual({ level: 1, id: "field-notes-on-export", text: "Field notes on export" });
    expect(toc.entries.map((entry) => entry.text)).toContain("Other scripts");
  });

  it("highlights code like the editor", () => {
    const [code] = find(doc.blocks, "code");
    expect(code.languageLabel).toBe("TypeScript");
    expect(code.lines[0][0]).toMatchObject({ scope: "comment", color: "#6a737d" });
    expect(code.lines.flat().find((token) => token.text === "function")).toMatchObject({ color: "#d73a49" });
  });

  it("drops trailing blank lines and zero-width spaces", () => {
    const value = [
      { type: "p", children: [{ text: "a\u200B" }] },
      { type: "p", children: [{ text: "\u200B" }] },
      { type: "p", children: [{ text: "b" }] },
      { type: "p", children: [{ text: "" }] },
    ];
    const blocks = buildExportDocument(value, { fileName: "x" }).blocks;
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "spacer", "paragraph"]);
  });

  it("refuses script links", () => {
    const value = [{ type: "p", children: [{ type: "a", url: "javascript:alert(1)", children: [{ text: "x" }] }] }];
    const [paragraph] = buildExportDocument(value, { fileName: "x" }).blocks;
    expect(paragraph).toMatchObject({ content: [{ type: "text", text: "x" }] });
  });
});

describe("export helpers", () => {
  it("normalizes colors", () => {
    expect(normalizeColor("#ABC")).toBe("#aabbcc");
    expect(normalizeColor("rgb(255, 0, 16)")).toBe("#ff0010");
    expect(normalizeColor("rgba(0,0,0,0)")).toBeUndefined();
    expect(normalizeColor("tomato")).toBeUndefined();
  });

  it("formats plain dates as calendar days", () => {
    expect(formatDate("2026-01-01", "en-US")).toBe("January 1, 2026");
  });

  it("recognizes images by their bytes", () => {
    expect(sniffImageMime(testPng(2, 2))).toBe("image/png");
    expect(sniffImageMime(new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="x"/>'))).toBe("image/svg+xml");
    expect(sniffImageMime(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(measureSvg(new TextEncoder().encode('<svg viewBox="0 0 200 100" width="400">'))).toEqual({ width: 400, height: 200 });
  });

  it("resolves image paths in the vault and next to the shard", () => {
    const context = { vaultPath: "C:/Vault", shardPath: "C:/Vault/notes/a.md" };
    expect(resolveImagePath("_attachments/x.png", context)).toBe("C:/Vault/_attachments/x.png");
    expect(resolveImagePath("../img/my%20pic.png", context)).toBe("C:/Vault/img/my pic.png");
    expect(resolveImagePath("https://example.com/a.png", context)).toBeNull();
  });

  it("picks Letter where it is the norm", () => {
    expect(getDefaultPageSize("en-US")).toBe("letter");
    expect(getDefaultPageSize("en-GB")).toBe("a4");
    expect(getDefaultPageSize("fr")).toBe("a4");
  });
});

describe("HTML export", () => {
  const doc = fixtureDocument();
  const images = fixtureImages(doc);
  const options = { ...BASE_OPTIONS, format: "html" as const };
  const loadAsset = async (url: string) => new Uint8Array(fs.readFileSync(path.join(ROOT, url.split("?")[0])));

  it("renders every block", () => {
    const html = renderHtmlBody(doc, images);
    expect(html).toContain('<h1 id="field-notes-on-export">');
    expect(html).toContain('<ol style="list-style-type:decimal">');
    expect(html).toContain('<li class="todo-item checked">');
    expect(html).toContain('<aside class="callout">');
    expect(html).toContain('<span class="hl-keyword">');
    expect(html).toContain('class="katex"');
    expect(html).toContain("<th>");
    expect(html).toContain('class="columns"');
    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('<div class="media-card">');
    expect(html).toContain('<a class="media-card" href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">');
  });

  it("escapes shard text", () => {
    const value = [{ type: "p", children: [{ text: '<script>alert("x")</script>' }] }];
    const html = renderHtmlBody(buildExportDocument(value, { fileName: "x" }), new Map());
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("embeds only the fonts the shard needs", () => {
    const faces = selectFontFaces(doc, { typeface: "newsreader" }).map((face) => `${face.family} ${face.subset} ${face.style}`);
    expect(faces).toContain("Newsreader latin normal");
    expect(faces).toContain("Geist Mono latin normal");
    expect(faces).toContain("Geist cyrillic normal");
    expect(faces).not.toContain("Newsreader vietnamese normal");

    const plain = buildExportDocument([{ type: "p", children: [{ text: "plain" }] }], { fileName: "x" });
    expect(selectFontFaces(plain, { typeface: "geist" }).map((face) => face.family)).not.toContain("Newsreader");
  });

  it("writes a complete web page in the chosen theme", async () => {
    const html = await renderHtmlDocument(doc, { images, options, mode: "web", loadAsset, lang: "en" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>Field notes on export</title>");
    expect(html).toContain('font-family:"Newsreader"');
    expect(html).toContain("font-family:KaTeX_Main");
    expect(html).toContain('<meta name="color-scheme" content="light">');
    expect(html).not.toContain("<script>");

    const dark = await renderHtmlDocument(doc, { images, options: { ...options, theme: "dark" }, mode: "web", loadAsset });
    expect(dark).toContain('<meta name="color-scheme" content="dark">');
    expect(dark).not.toContain("prefers-color-scheme:dark");

    if (process.env.EXPORT_FIXTURE_OUT) {
      fs.mkdirSync(process.env.EXPORT_FIXTURE_OUT, { recursive: true });
      fs.writeFileSync(path.join(process.env.EXPORT_FIXTURE_OUT, "everything.html"), html);
    }
  });

  it("follows the text size", async () => {
    const small = await renderHtmlDocument(doc, { images, options: { ...options, textSize: "small" }, mode: "web", loadAsset });
    const large = await renderHtmlDocument(doc, { images, options: { ...options, textSize: "large" }, mode: "web", loadAsset });
    expect(small).toContain("font-size:15px");
    expect(large).toContain("font-size:19px");
  });
});

describe("PDF export", () => {
  const doc = fixtureDocument();
  const images = fixtureImages(doc);
  const loadAsset = async (url: string) => new Uint8Array(fs.readFileSync(path.join(ROOT, url.split("?")[0])));

  it("prints on the chosen paper with a footer", async () => {
    const html = await renderHtmlDocument(doc, {
      images,
      options: { ...BASE_OPTIONS, pageSize: "letter", margins: "wide" },
      mode: "print",
      loadAsset,
    });
    expect(html).toContain("@page{size:215.9mm 279.4mm;margin:30mm 34mm 32mm 34mm;");
    expect(html).toContain('@bottom-left{content:"Field notes on export"');
    expect(html).toContain('content:counter(page) " / " counter(pages)');
    expect(html).toContain('fetch("ready")');
    expect(html).toContain("font-size:11pt");
  });

  it("leaves the footer out when page numbers are off", async () => {
    const html = await renderHtmlDocument(doc, { images, options: { ...BASE_OPTIONS, pageNumbers: false }, mode: "print", loadAsset });
    expect(html).not.toContain("@bottom-left");
  });

  it("quotes the title safely in the footer", () => {
    expect(cssString('Notes "draft" \\ v2\nfinal')).toBe('"Notes \\"draft\\" \\\\ v2 final"');
  });

  it("previews once and restyles in place", async () => {
    const html = await renderPreviewDocument(doc, { images, options: BASE_OPTIONS, loadAsset });
    expect(html).toContain('<div class="flow" id="flow">');
    expect(html).toContain('data-layout="pages"');
    expect(html).toContain('data-page-numbers="true"');
    expect(html).toContain('<style id="look">');
    expect(html).toContain("column-fill:auto");
    // Both typefaces are there, so switching needs no reload.
    expect(html).toContain('font-family:"Newsreader"');
    expect(html).toContain("netherstone-export-preview-look");

    const web = previewLook({ ...BASE_OPTIONS, format: "html", theme: "dark" });
    expect(web.layout).toBe("web");
    expect(web.css).toContain("color-scheme:dark");
    const letter = previewLook({ ...BASE_OPTIONS, pageSize: "letter", pageNumbers: false });
    expect(letter).toMatchObject({ layout: "pages", pageNumbers: false });
    expect(letter.css).toContain("--page-width:816px");

    if (process.env.EXPORT_FIXTURE_OUT) {
      fs.writeFileSync(path.join(process.env.EXPORT_FIXTURE_OUT, "everything-preview.html"), html);
    }
  });
});

describe("export options", () => {
  it("start from the reading settings", () => {
    expect(defaultExportOptions({ readingFont: "system", textSize: "large" })).toMatchObject({
      typeface: "geist",
      textSize: "large",
      format: "pdf",
    });
  });

  it("restore what was saved and ignore anything unknown", () => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    } as Storage;

    saveExportOptions({ ...BASE_OPTIONS, format: "docx", margins: "wide" });
    store.set("netherstone-export-options", JSON.stringify({ ...JSON.parse(store.get("netherstone-export-options")!), textSize: "huge" }));
    expect(loadExportOptions(BASE_OPTIONS)).toEqual({ ...BASE_OPTIONS, format: "docx", margins: "wide" });
  });
});
