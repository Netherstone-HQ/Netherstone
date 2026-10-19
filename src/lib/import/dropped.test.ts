// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { readDrop } from "./dropped";

type Tree = { [name: string]: string | Tree };

/** A dropped folder or file as the browser hands it over, from a plain tree. */
function entry(name: string, value: string | Tree): FileSystemEntry {
  if (typeof value === "string") {
    return { name, isFile: true, isDirectory: false, file: (done: (file: File) => void) => done(new File([value], name)) } as unknown as FileSystemEntry;
  }
  const children = Object.entries(value).map(([child, inner]) => entry(child, inner));
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => {
      // Two batches, then an empty one, like Chromium.
      const batches = [children.slice(0, 1), children.slice(1), []];
      return { readEntries: (done: (entries: FileSystemEntry[]) => void) => done(batches.shift() ?? []) };
    },
  } as unknown as FileSystemEntry;
}

function dataTransfer(entries: FileSystemEntry[]) {
  return { items: entries.map((value) => ({ kind: "file", webkitGetAsEntry: () => value, getAsFile: () => null })) } as unknown as DataTransfer;
}

describe("dropped files", () => {
  it("walks dropped folders like picked ones", async () => {
    const dropped = await readDrop(
      dataTransfer([
        entry("Notes", { "b.md": "B", ".obsidian": { "app.json": "{}" }, Plans: { "Q3.docx": "doc" }, "a.md": "A" }),
        entry("Report.pdf", "%PDF"),
      ]),
    );

    expect(dropped.sources.map((source) => source.relativePath)).toEqual([
      "Notes/a.md",
      "Notes/b.md",
      "Notes/Plans/Q3.docx",
      "Report.pdf",
    ]);
    expect(new TextDecoder().decode(await dropped.read(dropped.sources[1].path))).toBe("B");
  });
});
