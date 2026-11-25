import { describe, expect, it } from "vitest";
import type { Shared } from "@/lib/commands/incoming";
import { shareContent, shareTitle } from "./share-in";

const share = (text: string | null, subject: string | null = null, files: Shared["files"] = []): Shared => ({
  text,
  subject,
  files,
});

describe("shareContent", () => {
  it("takes a shared page as a link called by its subject", () => {
    expect(shareContent(share("https://docs.example.com/develop/", "Develop for Android")).link).toEqual({
      url: "https://docs.example.com/develop/",
      title: "Develop for Android",
      site: "docs.example.com",
    });
  });

  it("calls a link by the line beside it, or by its site", () => {
    expect(shareContent(share("Worth reading https://www.example.com/a")).link?.title).toBe(
      "Worth reading",
    );
    expect(shareContent(share("https://www.example.com/a")).link?.title).toBe("example.com");
  });

  it("keeps other text as text", () => {
    const notes = "Buy milk\nCall the bank https://bank.example";
    expect(shareContent(share(notes))).toEqual({ link: null, text: notes, files: [] });
    const twoLinks = "https://a.example https://b.example";
    expect(shareContent(share(twoLinks)).text).toBe(twoLinks);
  });
});

describe("shareTitle", () => {
  it("names a shard by the link, the text's first line or the one file", () => {
    expect(shareTitle(shareContent(share("https://example.com", "A: B/C?")))).toBe("A B C");
    expect(shareTitle(shareContent(share("Groceries\nmilk")))).toBe("Groceries");
    const photo = { name: "IMG_2041.jpg", type: "image/jpeg", path: "/cache/IMG_2041.jpg" };
    expect(shareTitle(shareContent(share(null, null, [photo])))).toBe("IMG_2041");
  });

  it("cuts long text at a word", () => {
    const long = "word ".repeat(30).trim();
    const title = shareTitle(shareContent(share(long)));
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith("word")).toBe(true);
  });

  it("falls back to the date for several files", () => {
    const files = [
      { name: "a.png", type: "image/png", path: "/a.png" },
      { name: "b.png", type: "image/png", path: "/b.png" },
    ];
    expect(shareTitle(shareContent(share(null, null, files)))).toMatch(/^Shared, /);
  });
});
