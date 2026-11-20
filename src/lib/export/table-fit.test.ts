import { describe, expect, it } from "vitest";

import { fitColumns } from "./table-fit";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("fitting table columns to the page", () => {
  it("keeps the writer's proportions when every column has room", () => {
    expect(fitColumns([1, 3], [100, 100], 1000)).toEqual({ widths: [250, 750], scale: 1 });
  });

  it("holds a column that would be too narrow at its minimum and shares the rest", () => {
    const { widths, scale } = fitColumns([1, 1, 1], [500, 100, 100], 900);
    expect(scale).toBe(1);
    expect(widths).toEqual([500, 200, 200]);
  });

  it("holds columns pushed under their minimum by another held column", () => {
    const { widths } = fitColumns([4, 4, 1], [500, 380, 0], 900);
    expect(widths[0]).toBe(500);
    expect(widths[1]).toBe(380);
    expect(sum(widths)).toBe(900);
  });

  it("shrinks a table whose words don't fit side by side, in proportion", () => {
    const { widths, scale } = fitColumns([1, 1], [600, 900], 1000);
    expect(scale).toBeCloseTo(1000 / 1500);
    expect(widths).toEqual([400, 600]);
  });

  it("adds up to the width exactly after rounding", () => {
    const { widths } = fitColumns([1, 1, 1], [0, 0, 0], 1000);
    expect(sum(widths)).toBe(1000);
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
  });
});
