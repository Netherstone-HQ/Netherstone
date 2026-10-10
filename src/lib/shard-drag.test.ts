import { describe, expect, it } from "vitest";

import { canMoveShardInto, getParentFolder } from "./shard-drag";

describe("getParentFolder", () => {
  it("handles forward and back slashes", () => {
    expect(getParentFolder("C:/Notes/Work/Plan.md")).toBe("C:/Notes/Work");
    expect(getParentFolder("C:\\Notes\\Work\\Plan.md")).toBe("C:\\Notes\\Work");
  });
});

describe("canMoveShardInto", () => {
  const shard = "C:/Notes/Work/Plan.md";

  it("refuses the folder the shard is already in", () => {
    expect(canMoveShardInto(shard, "C:/Notes/Work")).toBe(false);
    expect(canMoveShardInto(shard, "C:\\Notes\\Work")).toBe(false);
  });

  it("accepts any other folder, nested or not", () => {
    expect(canMoveShardInto(shard, "C:/Notes")).toBe(true);
    expect(canMoveShardInto(shard, "C:/Notes/Work/Archive/2026")).toBe(true);
    expect(canMoveShardInto(shard, "C:/Notes/Home")).toBe(true);
  });
});
