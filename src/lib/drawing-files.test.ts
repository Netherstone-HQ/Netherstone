import { describe, expect, it } from "vitest";
import {
  buildDrawingImageTag,
  getDrawingLinkNeedles,
  isPathWithin,
  isSamePath,
  relinkDrawingImages,
  remapPathAfterMove,
  replaceLinkedDrawingImages,
  resolveVaultRelativePath,
  toVaultRelativePath,
} from "@/lib/drawing-files";
import { loadMarkdown, roundTrip } from "@/test/markdown";

const exportTag = (drawingRef: string | null, width = "480") =>
  buildDrawingImageTag({
    src: "_attachments/ab/new.png",
    alt: "Flow",
    width,
    drawingRef,
  });

describe("vault paths", () => {
  it("converts between absolute and vault-relative paths", () => {
    expect(
      toVaultRelativePath("C:\\vault\\d\\Flow.excalidraw", "C:\\vault"),
    ).toBe("d/Flow.excalidraw");
    expect(resolveVaultRelativePath("d/Flow.excalidraw", "C:\\vault\\")).toBe(
      "C:\\vault\\d\\Flow.excalidraw",
    );
    expect(resolveVaultRelativePath("d/Flow.excalidraw", "/vault")).toBe(
      "/vault/d/Flow.excalidraw",
    );
  });

  it("matches the same path written with either separator", () => {
    expect(isSamePath("C:\\v\\a.md", "C:\\v/a.md")).toBe(true);
    expect(isSamePath("C:\\v\\a.md", "C:\\v\\b.md")).toBe(false);
  });

  it("remaps a drawing inside a renamed folder", () => {
    expect(isPathWithin("/vault/a/b.excalidraw", "/vault/a")).toBe(true);
    expect(isPathWithin("/vault/ab.excalidraw", "/vault/a")).toBe(false);
    expect(
      remapPathAfterMove("C:\\v\\a\\b.excalidraw", "C:\\v\\a", "C:\\v\\c"),
    ).toBe("C:\\v\\c\\b.excalidraw");
    expect(remapPathAfterMove("/v/x.excalidraw", "/v/a", "/v/c")).toBeNull();
  });
});

describe("linked drawing images", () => {
  it("keep their drawing link and width through an open-and-save cycle", () => {
    const markdown = `${exportTag("d/Flow & co.excalidraw")}\n`;
    const [image] = loadMarkdown(markdown);

    expect(image).toMatchObject({
      type: "img",
      url: "_attachments/ab/new.png",
      width: 480,
      "data-excalidraw": "d/Flow & co.excalidraw",
    });

    const saved = roundTrip(markdown);
    expect(saved).toContain('data-excalidraw="d/Flow & co.excalidraw"');
    expect(saved).toContain('width="480"');
    expect(roundTrip(saved)).toBe(saved);
  });

  it("leave other images as markdown images", () => {
    expect(roundTrip("![alt](_attachments/x.png)\n")).toBe(
      "![alt](_attachments/x.png)\n",
    );
  });

  it("are replaced on re-export, keeping each image's width", () => {
    const markdown = [
      "Intro",
      '<img src="_attachments/old.png" alt="Flow" width="300" data-excalidraw="d/Flow &amp; co.excalidraw" />',
      '<img src="other.png" data-excalidraw="d/Other.excalidraw" />',
      "",
    ].join("\n\n");

    const next = replaceLinkedDrawingImages(
      markdown,
      "d/Flow & co.excalidraw",
      (width) => exportTag("d/Flow & co.excalidraw", width ?? "480"),
    );

    expect(next).toContain(
      'src="_attachments/ab/new.png" alt="Flow" width="300"',
    );
    expect(next).not.toContain("old.png");
    expect(next).toContain('src="other.png"');
  });

  it("are matched after the editor re-saves them", () => {
    const saved = roundTrip(`${exportTag("d/Flow & co.excalidraw")}\n`);

    expect(
      replaceLinkedDrawingImages(saved, "d/Flow & co.excalidraw", () => "NEW"),
    ).toBe("NEW\n");
  });

  it("report when no image is linked to the drawing", () => {
    expect(
      replaceLinkedDrawingImages(
        `${exportTag(null)}\n`,
        "d/Flow.excalidraw",
        () => "",
      ),
    ).toBeNull();
  });

  it("are relinked when their drawing is renamed", () => {
    const markdown = [
      '<img src="a.png" width="300" data-excalidraw="d/Flow &amp; co.excalidraw" />',
      '<img src="b.png" data-excalidraw="d/Flow & co.excalidraw" />',
      '<img src="c.png" data-excalidraw="d/Other.excalidraw" />',
    ].join("\n\n");

    const next = relinkDrawingImages(
      markdown,
      "d/Flow & co.excalidraw",
      "d/$1 Flow.excalidraw",
    );

    expect(next).toBe(
      [
        '<img src="a.png" width="300" data-excalidraw="d/$1 Flow.excalidraw" />',
        '<img src="b.png" data-excalidraw="d/$1 Flow.excalidraw" />',
        '<img src="c.png" data-excalidraw="d/Other.excalidraw" />',
      ].join("\n\n"),
    );
  });

  it("are relinked when a folder containing their drawing moves", () => {
    const markdown =
      '<img src="a.png" data-excalidraw="d/sub/Flow.excalidraw" />\n';

    expect(relinkDrawingImages(markdown, "d", "archive/d")).toBe(
      '<img src="a.png" data-excalidraw="archive/d/sub/Flow.excalidraw" />\n',
    );
    expect(relinkDrawingImages(markdown, "d/s", "x")).toBeNull();
  });

  it("are found by the search needles however they were saved", () => {
    const needles = getDrawingLinkNeedles("d/Flow & co.excalidraw");
    const exported = exportTag("d/Flow & co.excalidraw");
    const resaved = roundTrip(`${exported}\n`);

    for (const text of [exported, resaved]) {
      expect(needles.some((needle) => text.includes(needle))).toBe(true);
    }
  });
});
