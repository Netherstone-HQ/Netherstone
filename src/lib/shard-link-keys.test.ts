import { createSlateEditor } from "platejs";
import { describe, expect, it } from "vitest";

import { SerializationKit } from "@/components/editor/serialization-kit";
import type { FileTreeNode } from "@/store";
import { remapShardLinkKeys, resolveShardLinkKeys } from "./shard-link-keys";

const TREE: FileTreeNode[] = [
  {
    name: "Work",
    path: "C:/Vault/Work",
    kind: "directory",
    children: [{ name: "Plan.md", path: "C:/Vault/Work/Plan.md", kind: "file" }],
  },
  { name: "Ideas.md", path: "C:/Vault/Ideas.md", kind: "file" },
];

const mention = (value: string, key?: string) => ({
  type: "mention",
  value,
  ...(key ? { key } : {}),
  children: [{ text: "" }],
});
const paragraph = (...children: object[]) => ({ type: "p", children });

describe("resolveShardLinkKeys", () => {
  it("points old and stale links at the shard's current path", () => {
    const value = [
      paragraph(
        mention("Plan", "C:/Vault/Old/Plan.md-2"),
        mention("Ideas"),
        mention("Plan", "Work/Plan.md"),
      ),
    ];
    const resolved = resolveShardLinkKeys(value, TREE, "C:/Vault/Today.md", "C:/Vault");
    expect(resolved[0].children.map((child) => (child as { key?: string }).key)).toEqual([
      "C:/Vault/Work/Plan.md",
      "C:/Vault/Ideas.md",
      "C:/Vault/Work/Plan.md",
    ]);
  });

  it("returns the same value when every link is current, and keeps unknown ones", () => {
    const value = [paragraph(mention("Plan", "C:/Vault/Work/Plan.md"), mention("Gone", "Gone"))];
    const resolved = resolveShardLinkKeys(value, TREE, "C:/Vault/Today.md", "C:/Vault");
    expect(resolved).toBe(value);
  });
});

describe("remapShardLinkKeys", () => {
  it("follows a moved folder and leaves other links alone", () => {
    const editor = createSlateEditor({
      plugins: SerializationKit,
      value: [
        paragraph(
          mention("Plan", "C:/Vault/Work/Plan.md"),
          mention("Notes", "C:/Vault/Work/2026/Notes.md"),
          mention("Ideas", "C:/Vault/Ideas.md"),
        ) as never,
      ],
    });

    expect(remapShardLinkKeys(editor, "C:/Vault/Work", "C:/Vault/Archive/Work")).toBe(2);
    const keys = (editor.children[0] as { children: { type?: string; key?: string }[] }).children
      .filter((child) => child.type === "mention")
      .map((child) => child.key);
    expect(keys).toEqual([
      "C:/Vault/Archive/Work/Plan.md",
      "C:/Vault/Archive/Work/2026/Notes.md",
      "C:/Vault/Ideas.md",
    ]);
  });
});
