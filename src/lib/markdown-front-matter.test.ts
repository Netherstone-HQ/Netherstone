import { describe, expect, it } from "vitest";
import { joinFrontMatter, splitFrontMatter } from "@/lib/markdown-front-matter";
import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";

describe("front matter", () => {
  it("splits a leading YAML block from the body", () => {
    expect(splitFrontMatter("---\ntitle: x\n---\n\n# Body\n")).toEqual({
      frontMatter: "---\ntitle: x\n---",
      body: "# Body\n",
    });
  });

  it("keeps the block as written, including CRLF and the closing marker", () => {
    expect(splitFrontMatter("---\r\ntitle: x\r\n...\r\nBody\r\n")).toEqual({
      frontMatter: "---\r\ntitle: x\r\n...",
      body: "Body\r\n",
    });
  });

  it("treats a shard that is only front matter as front matter", () => {
    expect(splitFrontMatter("---\ntitle: x\n---")).toEqual({
      frontMatter: "---\ntitle: x\n---",
      body: "",
    });
    expect(roundTrip("---\ntitle: x\n---\n")).toBe("---\ntitle: x\n---\n");
  });

  it("leaves a rule or a block further down alone", () => {
    expect(splitFrontMatter("Intro\n\n---\ntitle: x\n---\n").frontMatter).toBeNull();
    expect(splitFrontMatter("---\n\nParagraph after a rule\n").frontMatter).toBeNull();
    expect(splitFrontMatter("--- not front matter\n").frontMatter).toBeNull();
  });

  it("joins the block back with one blank line before the body", () => {
    expect(joinFrontMatter("---\na: 1\n---", "Body\n")).toBe("---\na: 1\n---\n\nBody\n");
    expect(joinFrontMatter(null, "Body\n")).toBe("Body\n");
  });

  it("loads as a read-only block and saves back unchanged", () => {
    const markdown = "---\ntitle: x\ntags: [a, b]\n---\n\n# Body\n";
    const [first, second] = loadMarkdown(markdown);
    expect(first.type).toBe("front_matter");
    expect(first.value).toBe("---\ntitle: x\ntags: [a, b]\n---");
    expect(second.type).toBe("h1");
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("drops the block from the file when it is deleted in the editor", () => {
    expect(saveValue([{ type: "p", children: [{ text: "Body" }] }])).toBe("Body\n");
  });
});
