import { describe, expect, it } from "vitest";

import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";
import {
  cellNumber,
  chartData,
  columnNames,
  createChartNode,
  defaultChartSpec,
  niceTicks,
  parseChartComment,
  readTable,
  serializeChartComment,
} from "./chart";

const COSTS = [
  "| Students | Today | Recommended |",
  "| -------- | ----- | ----------- |",
  "| 15       | about \\$0.50 | \\$0.03–\\$0.05 |",
  "| 30       | about \\$0.67 | \\$0.04–\\$0.07 |",
  "",
].join("\n");

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
    expect(spec).toEqual({
      kind: "bar",
      x: "Week",
      y: ["km", "Runs"],
      title: "",
    });
    const saved = saveValue([...value, createChartNode(spec)]);
    expect(saved).toContain(
      "| Sep 21 | 1,015 | 3    | long |\n\n<!-- netherstone chart: bar; x Week; y km, Runs -->",
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

  it("reads rough amounts and ranges", () => {
    expect(cellNumber("about $0.50")).toBe(0.5);
    expect(cellNumber("about 15,000 tokens")).toBe(15000);
    expect(cellNumber("~3 hours")).toBe(3);
    expect(cellNumber("$0.03–$0.05")).toBeCloseTo(0.04);
    expect(cellNumber("10 to 20")).toBe(15);
    expect(cellNumber("5-10 km")).toBe(7.5);
    expect(cellNumber("about Q1")).toBeNull();
  });

  it("charts every cost column against the first column of a table of numbers", () => {
    const table = readTable(loadMarkdown(COSTS)[0]);
    expect(defaultChartSpec(table)).toEqual({
      kind: "bar",
      x: "Students",
      y: ["Today", "Recommended"],
      title: "",
    });
    const data = chartData(defaultChartSpec(table), table);
    expect(data.labels).toEqual(["15", "30"]);
    expect(data.series[0].values).toEqual([0.5, 0.67]);
    expect(data.series[1].values[0]).toBeCloseTo(0.04);
  });

  it("draws a gap for a cell that says it has no number", () => {
    const table = {
      columns: ["Month", "Words"],
      rows: [
        ["July", "4200"],
        ["Aug", "–"],
        ["Sep", "n/a"],
      ],
    };
    expect(chartData(defaultChartSpec(table), table).series).toEqual([
      { name: "Words", values: [4200, null, null] },
    ]);
  });

  it("names empty and repeated headers by their place", () => {
    expect(columnNames(["", "Cost", "Cost", ""])).toEqual([
      "Column 1",
      "Cost",
      "Cost (3)",
      "Column 4",
    ]);
    expect(columnNames(["", "Column 1"])).toEqual(["Column 1", "Column 1 (2)"]);
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
