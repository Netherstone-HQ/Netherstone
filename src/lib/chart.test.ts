import { describe, expect, it } from "vitest";

import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";
import {
  cellNumber,
  chartData,
  createChartNode,
  defaultChartSpec,
  niceTicks,
  parseChartComment,
  readTable,
  serializeChartComment,
} from "./chart";

const RUNS = [
  "| Week   | km    | Runs | Note |",
  "| ------ | ----- | ---- | ---- |",
  "| Sep 7  | 11    | 3    | easy |",
  "| Sep 14 | 9.5   | 2    |      |",
  "| Sep 21 | 1,015 | 3    | long |",
  "",
].join("\n");

describe("chart comment", () => {
  it("reads and writes the chart under a table", () => {
    const comment =
      "<!-- netherstone chart: line; x Week; y km, Runs; title km by week -->";
    const spec = parseChartComment(comment);
    expect(spec).toEqual({
      kind: "line",
      x: "Week",
      y: ["km", "Runs"],
      title: "km by week",
    });
    expect(serializeChartComment(spec!)).toBe(comment);
  });

  it("isn't taken for a table's own comment", () => {
    expect(
      parseChartComment("<!-- netherstone: widths 120 240 -->"),
    ).toBeNull();
  });

  it("keeps names from breaking the comment", () => {
    expect(
      serializeChartComment({
        kind: "bar",
        x: "a;b",
        y: ["c,d"],
        title: "x --> y --!> z",
      }),
    ).toBe("<!-- netherstone chart: bar; x a b; y c d; title x y z -->");
  });

  it("is saved under its table exactly as written", () => {
    const markdown =
      "| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- netherstone chart: bar; x a; y b -->\n";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("is saved after a table when added in the editor", () => {
    const value = loadMarkdown(RUNS);
    const spec = defaultChartSpec(readTable(value[0]));
    expect(spec).toEqual({ kind: "bar", x: "Week", y: ["km"], title: "" });
    const saved = saveValue([...value, createChartNode(spec)]);
    expect(saved).toContain(
      "| Sep 21 | 1,015 | 3    | long |\n\n<!-- netherstone chart: bar; x Week; y km -->",
    );
  });
});

describe("chart data", () => {
  it("reads numbers with separators, signs and units", () => {
    expect(cellNumber("1,015")).toBe(1015);
    expect(cellNumber("-3.5")).toBe(-3.5);
    expect(cellNumber("$12")).toBe(12);
    expect(cellNumber("45%")).toBe(45);
    expect(cellNumber("12 km")).toBe(12);
    expect(cellNumber("Q1")).toBeNull();
    expect(cellNumber("Week 3")).toBeNull();
    expect(cellNumber("2026-10-19")).toBeNull();
  });

  it("draws the named columns, or the first numbers when none fit", () => {
    const table = readTable(loadMarkdown(RUNS)[0]);
    expect(
      chartData({ kind: "bar", x: "Week", y: ["Runs"], title: "" }, table),
    ).toEqual({
      labels: ["Sep 7", "Sep 14", "Sep 21"],
      series: [{ name: "Runs", values: [3, 2, 3] }],
    });
    expect(
      chartData(
        { kind: "bar", x: "week", y: ["Note", "Gone"], title: "" },
        table,
      ).series,
    ).toEqual([{ name: "km", values: [11, 9.5, 1015] }]);
  });

  it("steps the value axis in round numbers from zero", () => {
    expect(niceTicks(0, 24)).toEqual([0, 10, 20, 30]);
    expect(niceTicks(-5, 8)).toEqual([-5, 0, 5, 10]);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });
});
