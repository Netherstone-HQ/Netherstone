import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readableText, roundTrip } from "@/test/markdown";

/**
 * Sample shards in `src/test/corpus`, each opened, saved and reopened the way
 * the app does it. Every later editor fix adds the cases it covers here.
 *
 * - `canonical/`: shards in exactly the form the editor writes. Opening and
 *   saving one must not change a byte, or every vault would get a spurious
 *   change on first save.
 * - `hand-written/`: shards written by hand or by other tools (Obsidian,
 *   GitHub). The first save may restyle them, but must keep every word, and
 *   the second save must match the first, so a file settles after one save.
 */
const CORPUS_DIR = path.resolve(__dirname, "../test/corpus");

function readCorpus(folder: string): [string, string][] {
  const dir = path.join(CORPUS_DIR, folder);
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .sort()
    .map((name) => [name, fs.readFileSync(path.join(dir, name), "utf8")]);
}

describe("round-trip corpus", () => {
  const canonical = readCorpus("canonical");
  const handWritten = readCorpus("hand-written");

  it("has samples in both folders", () => {
    expect(canonical.length).toBeGreaterThan(0);
    expect(handWritten.length).toBeGreaterThan(0);
  });

  it.each(canonical)("saves canonical/%s byte-for-byte", (_name, markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it.each([...canonical, ...handWritten])(
    "keeps every word of %s",
    (_name, markdown) => {
      expect(readableText(roundTrip(markdown))).toBe(readableText(markdown));
    },
  );

  it.each(handWritten)(
    "settles hand-written/%s after one save",
    (_name, markdown) => {
      const firstSave = roundTrip(markdown);
      expect(roundTrip(firstSave)).toBe(firstSave);
    },
  );
});
