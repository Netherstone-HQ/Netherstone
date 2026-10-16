import { describe, expect, it } from "vitest";

import type { FileTreeNode } from "@/store";
import { getLinkName, resolveDocumentLinks } from "./link-utils";

const file = (path: string): FileTreeNode => ({
  name: path.split("/").pop()!,
  path,
  kind: "file",
});
const FILES = [
  file("C:/Vault/Work/Plan.md"),
  file("C:/Vault/Ideas.md"),
  file("C:/Vault/Sketch.excalidraw"),
];

const paragraph = (...children: object[]) => ({ type: "p", children });
const mention = (value: string) => ({
  type: "mention",
  value,
  children: [{ text: "" }],
});
const link = (url: string, text: string) => ({
  type: "a",
  url,
  children: [{ text }],
});

describe("resolveDocumentLinks", () => {
  it("lists each link once, marking shards that don't exist", () => {
    const value = [
      paragraph(mention("Plan"), link("./Work/Plan.md", "the plan")),
      paragraph(link("./Sketch.excalidraw", "the sketch")),
      paragraph(
        link("https://www.excalidraw.com/docs", "docs"),
        link("https://www.excalidraw.com/docs", "docs again"),
        mention("Old plan"),
      ),
    ];
    const links = resolveDocumentLinks(
      value,
      "C:/Vault/Today.md",
      "C:/Vault",
      FILES,
    );

    expect(links.map((l) => [getLinkName(l), l.isValid])).toEqual([
      ["Plan", true],
      ["Sketch", true],
      ["excalidraw.com", true],
      ["Old plan", false],
    ]);
  });
});
