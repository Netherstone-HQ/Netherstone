// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Dot } from "./dot";

afterEach(cleanup);

const SRC = join(__dirname, "../..");

// Files where a middle dot is data, not a separator on screen: import
// parsers that read it, plain text that can't hold a drawn dot (a Word export
// and a bug report line), and the tests for them.
const TYPED_DOT_ALLOWED = new Set([
  "lib/import/formats/docx/math.ts",
  "lib/import/formats/pdf/layout.ts",
  "lib/export/docx.ts",
  "lib/bug-report.ts",
  "lib/bug-report.test.ts",
  "components/ui/dot.test.tsx",
]);

function* sourceFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield path;
  }
}

/** Lines of src/ matching `pattern`, outside the allowed files. */
function linesWith(pattern: RegExp, allowed: Set<string>) {
  const found: string[] = [];
  for (const path of sourceFiles(SRC)) {
    const name = relative(SRC, path).split("\\").join("/");
    if (allowed.has(name)) continue;
    readFileSync(path, "utf8")
      .split("\n")
      .forEach((line, index) => {
        if (pattern.test(line)) found.push(`src/${name}:${index + 1}`);
      });
  }
  return found;
}

describe("Dot", () => {
  it("keeps a space between the words around it", () => {
    const { container } = render(
      <p>
        3 files
        <Dot />
        1.2 MB
      </p>,
    );
    expect(container.textContent).toBe("3 files 1.2 MB");
  });

  it("is the only separator in the app: no typed middle dots", () => {
    expect(linesWith(/\u00B7|&middot;|&#183;|&#xb7;|\\u00b7/i, TYPED_DOT_ALLOWED)).toEqual([]);
  });

  it("is the only separator in the app: no dots drawn by hand", () => {
    expect(
      linesWith(
        /size-\[[2-4]px\][^"]*rounded-full|rounded-full[^"]*size-\[[2-4]px\]/,
        new Set(["components/ui/dot.tsx", "components/ui/dot.test.tsx"]),
      ),
    ).toEqual([]);
  });
});
