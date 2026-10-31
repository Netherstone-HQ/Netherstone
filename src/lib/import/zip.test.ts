// @vitest-environment jsdom
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { memoryImport } from "@/test/import";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

/** A zip file holding `files`, by path in it. */
async function zipOf(files: Record<string, Uint8Array | string>, options: { stored?: boolean } = {}) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  return zip.generateAsync({ type: "uint8array", compression: options.stored ? "STORE" : "DEFLATE" });
}

/** Offsets of the central directory entries in a zip file, in order. */
function centralEntries(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsets: number[] = [];
  for (let at = 0; at + 4 <= bytes.length; at += 1) if (view.getUint32(at, true) === 0x02014b50) offsets.push(at);
  return { view, offsets };
}

describe("zip import", () => {
  it("imports a zip file like a folder named after it, with its pictures", async () => {
    const zip = await zipOf({
      "Home.md": "# Home\n\nSee [[Plans]].\n\n![](_attachments/cat.png)\n",
      "Sub/Plans.md": "# Plans\n",
      "_attachments/cat.png": PNG,
      "__MACOSX/._Home.md": "noise",
      ".hidden.md": "# Hidden\n",
    });
    const vault = memoryImport({ "Converted files.zip": zip });
    const report = await vault.run();

    expect(report.failed).toEqual([]);
    expect(report.created.map((shard) => shard.path)).toEqual([
      "/vault/Converted files/Home.md",
      "/vault/Converted files/Sub/Plans.md",
    ]);
    expect(vault.shards.get("/vault/Converted files/Home.md")).toContain("See [Plans](Sub/Plans.md).");
    expect(vault.shards.get("/vault/Converted files/Home.md")).toContain("![](_attachments/cat.png)");
    expect([...vault.attachments.values()]).toEqual([PNG]);
    expect(vault.copied).toEqual([]);
    expect(report.skipped).toEqual([]);
  });

  it("imports a zipped folder as that folder", async () => {
    const zip = await zipOf({ "Notes/Home.md": "# Home\n", "Notes/Sub/Plans.md": "# Plans\n" });
    const vault = memoryImport({ "Notes (1).zip": zip });
    const report = await vault.run();

    expect(report.created.map((shard) => shard.path)).toEqual(["/vault/Notes/Home.md", "/vault/Notes/Sub/Plans.md"]);
  });

  it("works for dropped zip files and leaves zip files inside it closed", async () => {
    const inner = await zipOf({ "Deep.md": "# Deep\n" });
    const zip = await zipOf({ "Home.md": "# Home\n", "Inner.zip": inner });
    const vault = memoryImport({ "Archive.zip": zip }, { dropped: true });
    const report = await vault.run();

    expect(report.created.map((shard) => shard.path)).toEqual(["/vault/Archive/Home.md"]);
    expect(report.skipped).toEqual(["Archive/Inner.zip"]);
  });

  it("leaves out files whose path climbs out of the zip file", async () => {
    const zip = await zipOf({ "Home.md": "# Home\n", "aa/../../evil.md": "# Evil\n" });
    const vault = memoryImport({ "Archive.zip": zip });
    const report = await vault.run();

    expect(report.created.map((shard) => shard.path)).toEqual(["/vault/Archive/Home.md"]);
    expect(report.failed).toEqual([
      { source: "Archive.zip/aa/../../evil.md", error: "Its path in the zip file leads outside it, so it was left out." },
    ]);
  });

  it("doesn't open a zip file whose files overlap", async () => {
    const zip = await zipOf({ "One.md": "# One\n", "Two.md": "# Two\n" }, { stored: true });
    // Stretch the first file's data over the second file, as zip bombs do
    // file after file to unpack the same bytes over and over.
    const { view, offsets } = centralEntries(zip);
    const dataStart = (entry: number) => view.getUint32(entry + 42, true) + 30 + view.getUint16(entry + 28, true);
    const stretched = dataStart(offsets[1]) + view.getUint32(offsets[1] + 20, true) - dataStart(offsets[0]);
    view.setUint32(offsets[0] + 20, stretched, true);
    view.setUint32(offsets[0] + 24, stretched, true);
    const vault = memoryImport({ "Bomb.zip": zip });
    const report = await vault.run();

    expect(report.created).toEqual([]);
    expect(report.failed).toEqual([
      { source: "Bomb.zip", error: "The files in this zip file overlap each other, so it wasn't opened." },
    ]);
  });

  it("stops unpacking a file past the size its zip file gives", async () => {
    const zip = await zipOf({ "Home.md": `# Home\n\n${"words ".repeat(2000)}\n` });
    const { view, offsets } = centralEntries(zip);
    view.setUint32(offsets[0] + 24, 100, true);
    const vault = memoryImport({ "Archive.zip": zip });
    const report = await vault.run();

    expect(report.created).toEqual([]);
    expect(report.failed).toEqual([
      { source: "Archive/Home.md", error: "This file unpacks bigger than its zip file says, so it wasn't read." },
    ]);
  });

  it("reports a damaged zip file", async () => {
    const vault = memoryImport({ "Broken.zip": "not a zip" });
    const report = await vault.run();

    expect(report.failed).toEqual([
      { source: "Broken.zip", error: "This zip file is damaged or has a password, so it wasn't opened." },
    ]);
  });
});
