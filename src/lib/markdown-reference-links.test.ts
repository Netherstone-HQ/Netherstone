import { describe, expect, it } from "vitest";
import { inlineReferenceLinks } from "@/lib/markdown-reference-links";
import { roundTrip } from "@/test/markdown";

describe("reference links", () => {
  it("rewrites full, collapsed and shortcut references to inline links", () => {
    const markdown =
      "See [docs][d], [example][] and [spec].\n\n" +
      '[d]: https://example.com/docs "Project docs"\n' +
      "[example]: https://example.com\n" +
      "[spec]: <https://example.com/spec with spaces>\n";
    expect(inlineReferenceLinks(markdown)).toBe(
      'See [docs](https://example.com/docs "Project docs"), [example](https://example.com) and [spec](<https://example.com/spec with spaces>).\n',
    );
  });

  it("keeps formatting inside the link text and rewrites images", () => {
    expect(
      inlineReferenceLinks("A [**bold** link][d] and ![diagram][img].\n\n[d]: https://a.com\n[img]: pic.png\n"),
    ).toBe("A [**bold** link](https://a.com) and ![diagram](pic.png).\n");
  });

  it("leaves text that only looks like a reference alone", () => {
    // An unused definition stays too; the editor shows it as text rather
    // than dropping a URL the writer kept on purpose.
    const markdown = "A [[Wikilink]] and [missing][x] stay.\n\n[other]: https://o.com\n";
    expect(inlineReferenceLinks(markdown)).toBe(markdown);
    expect(inlineReferenceLinks("No definitions [here].\n")).toBe("No definitions [here].\n");
  });

  it("survives a save instead of being deleted", () => {
    expect(roundTrip("See [docs][d].\n\n[d]: https://example.com\n")).toBe(
      "See [docs](https://example.com).\n",
    );
  });
});
