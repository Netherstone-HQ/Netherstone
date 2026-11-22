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

// Rules that test a child's position on any element, like `*:first:`
// (`:is(.x > *):first-child`) or `space-y-*` (`> :not(:last-child)`),
// make WebKit restyle a whole sibling subtree when an element is added next
// to it: about a second per shard switch with a long shard open.
// `[&>span:first-child]:` or `last:` (a tag or class before the pseudo-class)
// don't. Use `gap-*` for spacing and a border on each row for dividers.
// `group-last/x:` and the like (`:is(:where(.group\/x):last-child *)`) test
// the position of every ancestor of the element: any child added or removed
// at the end of an ancestor, like a closed shard leaving, restyles the
// whole subtree next to it. Use `[&:last-child>.child]:` on the group.
const UNKEYED_STRUCTURAL = [
  /(?<![\w-])(group|peer|in)-(first|last|only|odd|even|nth-)/,
  /\*\]?:([\w-]+:|\[[^\]]*\]:)*(first|last|only|odd|even|nth-)/,
  /\[&[>_+~]\*?:(not\(:)?(first|last|only|nth-)/,
  /(?<![\w-])-?(space-[xy]|divide)-/,
];

it("has no Tailwind rule that tests the position of any child", () => {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    if (path === __filename) continue;
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (UNKEYED_STRUCTURAL.some((pattern) => pattern.test(line))) {
          found.push(`${relative(SRC, path)}:${index + 1}`);
        }
      });
  }
  expect(found).toEqual([]);
});
