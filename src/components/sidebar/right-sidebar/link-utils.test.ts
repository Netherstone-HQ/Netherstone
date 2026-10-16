import { describe, expect, it } from "vitest";

import type { FileTreeNode } from "@/store";
import {
  getLinkName,
  resolveDocumentLinks,
  resolveInternalTargetPath,
} from "./link-utils";

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

const VAULT = "C:/Vault";
const CURRENT = `${VAULT}/Home.md`;

const shard = (path: string): FileTreeNode => ({
  name: path.split("/").pop() ?? path,
  path,
  kind: "file",
});

// Two shards share a name, so only the path can pick the right one.
const SHARDS = [
  shard(`${VAULT}/Home.md`),
  shard(`${VAULT}/Projects/Netherstone roadmap.md`),
  shard(`${VAULT}/Archive/Netherstone roadmap.md`),
  shard(`${VAULT}/Issue #1.md`),
  shard(`${VAULT}/100% done.md`),
];

const resolve = (target: string) =>
  resolveInternalTargetPath(target, CURRENT, VAULT, SHARDS);

describe("resolveInternalTargetPath", () => {
  it("decodes a percent-encoded target", () => {
    expect(resolve("./Projects/Netherstone%20roadmap.md")).toBe(
      `${VAULT}/Projects/Netherstone roadmap.md`,
    );
    expect(resolve("Projects/Netherstone%20roadmap#goals")).toBe(
      `${VAULT}/Projects/Netherstone roadmap.md`,
    );
  });

  it("resolves a target with spaces, as the editor saves it", () => {
    // Plate saves this as `[roadmap](<./Projects/Netherstone roadmap.md>)`.
    expect(resolve("./Projects/Netherstone roadmap.md")).toBe(
      `${VAULT}/Projects/Netherstone roadmap.md`,
    );
  });

  it("decodes an encoded # as part of the name, not a heading", () => {
    expect(resolve("./Issue%20%231.md")).toBe(`${VAULT}/Issue #1.md`);
  });

  it("keeps a target that isn't valid percent-encoding as written", () => {
    expect(resolve("./100% done.md")).toBe(`${VAULT}/100% done.md`);
  });
});
