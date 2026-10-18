import { describe, expect, it } from "vitest";

import {
  cleanLegacyMentionKey,
  encodeShardLinkPath,
  isShardLinkTarget,
  relativePath,
  resolveShardLinkKey,
  shardLinkTarget,
} from "./markdown-shard-links";

describe("isShardLinkTarget", () => {
  it.each([
    ["Plan.md", true],
    ["../Projects/Plan.md", true],
    ["./My%20Plan.MD", true],
    ["C:/Vault/Plan.md", true],
    ["Plan.md#goals", false],
    ["Plan.md?x", false],
    ["https://example.com/Plan.md", false],
    ["mailto:a@b.md", false],
    ["#heading", false],
    ["img.png", false],
    ["", false],
  ])("%s -> %s", (url, expected) => {
    expect(isShardLinkTarget(url)).toBe(expected);
  });
});

describe("resolveShardLinkKey", () => {
  const FILE = "C:\\Vault\\Daily\\Today.md";

  it("resolves against the shard's folder", () => {
    expect(resolveShardLinkKey("Me.md", FILE)).toBe("C:/Vault/Daily/Me.md");
    expect(resolveShardLinkKey("../Projects/Plan.md", FILE)).toBe(
      "C:/Vault/Projects/Plan.md",
    );
    expect(resolveShardLinkKey("./a/../b/My%20note.md", FILE)).toBe(
      "C:/Vault/Daily/b/My note.md",
    );
  });

  it("keeps an absolute target and a target read without a path", () => {
    expect(resolveShardLinkKey("/home/me/Vault/Plan.md", FILE)).toBe(
      "/home/me/Vault/Plan.md",
    );
    expect(resolveShardLinkKey("../Plan.md", null)).toBe("../Plan.md");
  });
});

describe("relativePath", () => {
  it("walks up and down folders", () => {
    expect(relativePath("C:/Vault/Daily/Today.md", "C:/Vault/Daily/Me.md")).toBe("Me.md");
    expect(relativePath("C:/Vault/Daily/Today.md", "C:/Vault/Projects/Plan.md")).toBe(
      "../Projects/Plan.md",
    );
    expect(relativePath("C:/Vault/Today.md", "C:/Vault/Projects/A/Plan.md")).toBe(
      "Projects/A/Plan.md",
    );
    expect(relativePath("/home/me/Vault/A/B/Today.md", "/home/me/Vault/Plan.md")).toBe(
      "../../Plan.md",
    );
  });

  it("ignores the case of a drive letter and keeps another drive absolute", () => {
    expect(relativePath("c:/Vault/Today.md", "C:/Vault/Plan.md")).toBe("Plan.md");
    expect(relativePath("C:/Vault/Today.md", "D:/Other/Plan.md")).toBe("D:/Other/Plan.md");
  });
});

describe("shardLinkTarget", () => {
  it("encodes each segment the way the backend does", () => {
    expect(encodeShardLinkPath("../A b/It's (draft)!.md")).toBe(
      "../A%20b/It%27s%20%28draft%29%21.md",
    );
    expect(shardLinkTarget("C:/Vault/Projects/Plan 2.md", "C:/Vault/Daily/Today.md")).toBe(
      "../Projects/Plan%202.md",
    );
  });

  it("writes an unresolved name as a sibling shard", () => {
    expect(shardLinkTarget("Other Note", "C:/Vault/Today.md")).toBe("Other%20Note.md");
    expect(shardLinkTarget("sub/Other.md", null)).toBe("sub/Other.md");
  });
});

describe("cleanLegacyMentionKey", () => {
  it("drops the position suffix of an old path key, and nothing else", () => {
    expect(cleanLegacyMentionKey("C:\\Vault\\Plan.md-12")).toBe("C:/Vault/Plan.md");
    expect(cleanLegacyMentionKey("Plan-2026")).toBe("Plan-2026");
    expect(cleanLegacyMentionKey("Plan")).toBe("Plan");
  });
});
