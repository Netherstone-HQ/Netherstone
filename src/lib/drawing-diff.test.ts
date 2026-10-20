import { describe, expect, it } from "vitest";
import {
  ADDED_SHAPE_COLOR,
  REMOVED_SHAPE_COLOR,
  diffDrawingShapes,
} from "./drawing-diff";

const shape = (id: string, extra: object = {}) => ({
  id,
  type: "rectangle",
  strokeColor: "#1e1e1e",
  ...extra,
});

describe("diffDrawingShapes", () => {
  const version = [
    shape("kept"),
    shape("back"),
    shape("gone-then", { isDeleted: true }),
  ];
  const current = [shape("kept"), shape("new")];

  it("draws shapes that come back in green and ones that go away dashed", () => {
    const { shapes, hasChanges } = diffDrawingShapes(version, current, true);
    expect(hasChanges).toBe(true);
    expect(shapes.map((s) => [s.id, s.strokeColor])).toEqual([
      ["kept", "#1e1e1e"],
      ["back", ADDED_SHAPE_COLOR],
      ["new", REMOVED_SHAPE_COLOR],
    ]);
    expect(shapes[2]).toMatchObject({ strokeStyle: "dashed", locked: true });
  });

  it("shows the version as saved with changes off", () => {
    const { shapes } = diffDrawingShapes(version, current, false);
    expect(shapes.map((s) => s.id)).toEqual(["kept", "back"]);
    expect(shapes[1].strokeColor).toBe("#1e1e1e");
  });

  it("has no changes when only deleted shapes differ", () => {
    expect(
      diffDrawingShapes(
        [shape("a")],
        [shape("a"), shape("b", { isDeleted: true })],
        true,
      ),
    ).toMatchObject({ hasChanges: false });
  });
});
