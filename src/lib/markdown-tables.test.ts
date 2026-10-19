import { describe, expect, it } from "vitest";

import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";
import { cellRef, parseCellRef } from "./markdown-tables";

const p = (text: string, extra: object = {}) => ({
  type: "p",
  children: [{ text }],
  ...extra,
});
const cell = (type: "th" | "td", text: string, extra: object = {}) => ({
  type,
  children: [p(text)],
  ...extra,
});
const row = (...cells: object[]) => ({ type: "tr", children: cells });

describe("cell references", () => {
  it("names cells like a spreadsheet", () => {
    expect(cellRef(0, 0)).toBe("A1");
    expect(cellRef(2, 25)).toBe("Z3");
    expect(cellRef(0, 26)).toBe("AA1");
    expect(parseCellRef("AA1")).toEqual({ row: 0, col: 26 });
    expect(parseCellRef("b2")).toEqual({ row: 1, col: 1 });
    expect(parseCellRef("1A")).toBeNull();
  });
});

describe("table comment", () => {
  it("writes nothing extra for a plain table", () => {
    const markdown = "| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("saves column widths once set, and loads them back", () => {
    const table = {
      type: "table",
      colSizes: [120.4, 240],
      children: [row(cell("th", "a"), cell("th", "b")), row(cell("td", "1"), cell("td", "2"))],
    };
    const saved = saveValue([table]);
    expect(saved).toBe(
      "<!-- netherstone: widths 120 240 -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
    const [loaded] = loadMarkdown(saved);
    expect(loaded.type).toBe("table");
    expect(loaded.colSizes).toEqual([120, 240]);
    expect(saveValue([loaded])).toBe(saved);
  });

  it("keeps hand-written percentage widths", () => {
    const markdown =
      "<!-- netherstone: widths 25% 75% -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    const [loaded] = loadMarkdown(markdown);
    expect(loaded.colPercents).toEqual([25, 75]);
    expect(loaded.colSizes).toBeUndefined();
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("reads pixel widths written with px", () => {
    const [loaded] = loadMarkdown(
      "<!-- netherstone: widths 120px 240px -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
    expect(loaded.colSizes).toEqual([120, 240]);
  });

  it("saves dragged widths over hand-written percentages", () => {
    const table = {
      type: "table",
      colSizes: [100, 300],
      colPercents: [25, 75],
      children: [row(cell("th", "a"), cell("th", "b")), row(cell("td", "1"), cell("td", "2"))],
    };
    expect(saveValue([table])).toBe(
      "<!-- netherstone: widths 100 300 -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
  });

  it("ignores widths that mix pixels and percentages", () => {
    const [loaded] = loadMarkdown(
      "<!-- netherstone: widths 120 75% -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n",
    );
    expect(loaded.colSizes).toBeUndefined();
    expect(loaded.colPercents).toBeUndefined();
  });

  it("keeps the pipe table rectangular around merged cells", () => {
    const table = {
      type: "table",
      children: [
        row(cell("th", "Title", { colSpan: 2 }), cell("th", "c")),
        row(cell("td", "tall", { rowSpan: 2 }), cell("td", "b2"), cell("td", "c2")),
        row(cell("td", "b3"), cell("td", "c3")),
      ],
    };
    const saved = saveValue([table]);
    expect(saved).toBe(
      [
        "<!-- netherstone: merge A1:B1 A2:A3 -->",
        "",
        "| Title |   | c  |",
        "| ----- | -- | -- |",
        "| tall  | b2 | c2 |",
        "|      | b3 | c3 |",
        "",
      ].join("\n"),
    );

    const [loaded] = loadMarkdown(saved);
    const cells = loaded.children.map((r: { children: { colSpan?: number; rowSpan?: number; children: { children: { text: string }[] }[] }[] }) =>
      r.children.map((c) => [c.children[0].children[0].text, c.colSpan ?? 1, c.rowSpan ?? 1]),
    );
    expect(cells).toEqual([
      [["Title", 2, 1], ["c", 1, 1]],
      [["tall", 1, 2], ["b2", 1, 1], ["c2", 1, 1]],
      [["b3", 1, 1], ["c3", 1, 1]],
    ]);
    expect(saveValue([loaded])).toBe(saved);
  });

  it("saves cell colours and hidden borders", () => {
    const table = {
      type: "table",
      children: [
        row(cell("th", "a", { background: "#ff0000" }), cell("th", "b")),
        row(
          cell("td", "1", { borders: { top: { size: 0 }, left: { size: 0 }, bottom: { size: 1 } } }),
          cell("td", "2", { background: "rgb(1, 2, 3)" }),
        ),
      ],
    };
    const saved = saveValue([table]);
    expect(saved.split("\n")[0]).toBe(
      "<!-- netherstone: fill A1=#ff0000 B2=rgb(1,2,3); noborder A2 top left -->",
    );
    const [loaded] = loadMarkdown(saved);
    expect(loaded.children[0].children[0].background).toBe("#ff0000");
    expect(loaded.children[1].children[1].background).toBe("rgb(1,2,3)");
    expect(loaded.children[1].children[0].borders).toEqual({
      top: { size: 0 },
      left: { size: 0 },
    });
    expect(saveValue([loaded])).toBe(saved);
  });

  it("leaves a comment that isn't followed by a table as it is", () => {
    const markdown = "<!-- netherstone: widths 1 2 -->\n\nJust text.\n";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("ignores references outside the table", () => {
    const markdown =
      "<!-- netherstone: merge C1:D2; fill Z9=#fff; widths 1 2 3 -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
    expect(roundTrip(markdown)).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n");
  });
});

describe("column alignment", () => {
  it("loads :---: into the cells' paragraphs and saves it back", () => {
    const markdown = "| a  |  b  |  c |\n| :- | :-: | -: |\n| 1  |  2  |  3 |\n";
    const [table] = loadMarkdown(markdown);
    const aligns = table.children.map((r: { children: { children: { align?: string }[] }[] }) =>
      r.children.map((c) => c.children[0].align ?? null),
    );
    expect(aligns).toEqual([
      ["left", "center", "right"],
      ["left", "center", "right"],
    ]);
    expect(saveValue([table])).toBe(markdown);
  });

  it("takes the header's alignment as the column's", () => {
    const table = {
      type: "table",
      children: [
        row(cell("th", "a"), { type: "th", children: [p("b", { align: "center" })] }),
        row(cell("td", "1"), cell("td", "2")),
      ],
    };
    expect(saveValue([table])).toBe("| a |  b  |\n| - | :-: |\n| 1 |  2  |\n");
  });
});
