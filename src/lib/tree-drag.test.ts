import { describe, expect, it } from "vitest";

import { canMoveInto, getParentFolder } from "./tree-drag";

describe("getParentFolder", () => {
  it("handles forward and back slashes", () => {
    expect(getParentFolder("C:/Notes/Work/Plan.md")).toBe("C:/Notes/Work");
    expect(getParentFolder("C:\\Notes\\Work\\Plan.md")).toBe("C:\\Notes\\Work");
  });
});

describe("canMoveInto", () => {
  it("refuses the folder a shard is already in", () => {
    const shard = "C:/Notes/Work/Plan.md";
    expect(canMoveInto(shard, "C:/Notes/Work")).toBe(false);
    expect(canMoveInto(shard, "C:\\Notes\\Work")).toBe(false);
  });

  it("accepts any other folder, nested or not", () => {
    const shard = "C:/Notes/Work/Plan.md";
    expect(canMoveInto(shard, "C:/Notes")).toBe(true);
    expect(canMoveInto(shard, "C:/Notes/Work/Archive/2026")).toBe(true);
    expect(canMoveInto(shard, "C:/Notes/Home")).toBe(true);
  });

  it("refuses moving a folder into itself or its own subfolders", () => {
    const folder = "C:/Notes/Work";
    expect(canMoveInto(folder, "C:/Notes/Work")).toBe(false);
    expect(canMoveInto(folder, "C:/Notes/Work/Archive")).toBe(false);
    expect(canMoveInto(folder, "C:/Notes")).toBe(false);
  });

  it("lets a folder move next to or into a sibling", () => {
    const folder = "C:/Notes/Work";
    expect(canMoveInto(folder, "C:/Notes/Home")).toBe(true);
    expect(canMoveInto(folder, "C:/Notes/Workshop")).toBe(true);
  });
});
