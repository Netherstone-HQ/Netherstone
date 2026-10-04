import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND, FACET, LEFT, RIGHT, SILHOUETTE, TOP } from "./NetherstoneMark";
import { WORDMARK } from "./NetherstoneWordmark";

// index.html draws the mark by hand so the splash shows before any script
// loads. This keeps that copy the same as the component.
describe("launch splash mark", () => {
  const html = readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");
  const start = html.indexOf('<svg class="splash-mark"');
  const splash = html.slice(start, html.indexOf("</svg>", start));
  const paths = [...splash.matchAll(/<path d="([^"]+)" fill="([^"]+)"/g)].map(
    ([, d, fill]) => ({ d, fill }),
  );

  it("draws the same faces as NetherstoneMark", () => {
    expect(paths).toEqual([
      { d: SILHOUETTE, fill: "#FFF" },
      { d: SILHOUETTE, fill: BRAND.left },
      { d: LEFT, fill: BRAND.left },
      { d: RIGHT, fill: BRAND.right },
      { d: TOP, fill: BRAND.top },
      { d: FACET, fill: BRAND.facet },
    ]);
  });

  it("draws the same wordmark as NetherstoneWordmark", () => {
    const start = html.indexOf('<svg class="splash-wordmark"');
    const wordmark = html.slice(start, html.indexOf("</svg>", start));
    expect(wordmark).toContain(`<path d="${WORDMARK}"`);
  });
});
