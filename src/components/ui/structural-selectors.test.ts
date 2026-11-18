import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";

const SRC = join(__dirname, "../..");

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield path;
  }
}

// `*:first:` builds `:is(.x > *):first-child`, which WebKit tests on every
// element of the page. Then adding or removing any element restyles its
// siblings in full: about a second per shard switch with a long shard open.
// `[&>span:first-child]:` (a tag or class before the pseudo-class) doesn't.
const UNKEYED_STRUCTURAL = /\*:(\[[^\]]*\]:)*(first|last|only|odd|even|nth-)/;

it("has no Tailwind child variant with a position pseudo-class", () => {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    if (path === __filename) continue;
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (UNKEYED_STRUCTURAL.test(line)) {
          found.push(`${relative(SRC, path)}:${index + 1}`);
        }
      });
  }
  expect(found).toEqual([]);
});
