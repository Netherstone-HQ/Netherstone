import type { Page } from "@playwright/test";

import {
  caretAfter,
  cellsOf,
  editor,
  expect,
  lastSave,
  measureTables,
  mockVault,
  test,
} from "./vault";

const TABLE_NOTE = `# Tables

| Name | Description | Status |
| - | - | - |
| Alpha | A fairly long description that should take most of the width of the editor when shown, because it is the longest cell. | Done |
| Beta | Short | In progress |

After the table.
`;

test("a Markdown table renders with its rows and columns", async ({ page }) => {
  await mockVault(page, { files: { "Tables.md": TABLE_NOTE }, open: "Tables.md" });

  const table = editor(page).locator("table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("tr")).toHaveCount(3);
  await expect(cellsOf(table.locator("tr").first())).toHaveCount(3);

  const [measure] = await measureTables(page);
  expect(measure.columns).toHaveLength(3);
  // The cells stay inside the text column; the thin control column hangs in the gutter.
  const cellsWidth = measure.columns.reduce((total, width) => total + width, 0);
  expect(cellsWidth).toBeLessThanOrEqual(measure.editorWidth);
});

test("editing a cell keeps the rest of the table", async ({ page }) => {
  await mockVault(page, { files: { "Tables.md": TABLE_NOTE }, open: "Tables.md" });

  await caretAfter(page, "Short");
  await page.keyboard.type(" and sweet");

  const saved = await lastSave(page, "Tables.md");
  expect(saved).toContain("| Name");
  expect(saved).toMatch(/\| Beta\s+\| Short and sweet\s+\| In progress\s+\|/);
  expect(saved).toContain("After the table.");
});

/** Whether the table's block scrolls sideways. */
async function scrollsSideways(page: Page, index = 0) {
  return editor(page)
    .locator("table")
    .nth(index)
    .evaluate((table) => {
      const wrapper = table.closest("[data-slate-node='element']") as HTMLElement;
      return wrapper.scrollWidth > wrapper.clientWidth;
    });
}

test("a table without saved widths is as wide as its content, up to the text column", async ({
  page,
}) => {
  await mockVault(page, {
    files: { "Tables.md": `${TABLE_NOTE}\n| a | b |\n| - | - |\n| 1 | 2 |\n` },
    open: "Tables.md",
  });

  const [long, small] = await measureTables(page);
  // Long text wraps at the text column, without a scrollbar.
  const longCells = long.columns.reduce((total, width) => total + width, 0);
  expect(longCells).toBeGreaterThanOrEqual(long.editorWidth * 0.9);
  expect(longCells).toBeLessThanOrEqual(long.editorWidth);
  expect(await scrollsSideways(page, 0)).toBe(false);
  // The long description gets most of the room.
  expect(long.columns[1]).toBeGreaterThan(long.columns[0] * 2);
  expect(Math.min(...long.columns)).toBeGreaterThanOrEqual(64);
  // Two tiny cells stay small.
  expect(small.columns.reduce((total, width) => total + width, 0)).toBeLessThan(200);
  expect(await scrollsSideways(page, 1)).toBe(false);
});

test("percentage widths are shares of the text column", async ({ page }) => {
  await mockVault(page, {
    files: {
      "Tables.md":
        "# Tables\n\n<!-- netherstone: widths 30% 30% -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.\n",
    },
    open: "Tables.md",
  });

  const [measure] = await measureTables(page);
  for (const width of measure.columns) {
    expect(Math.abs(width - measure.editorWidth * 0.3)).toBeLessThan(4);
  }
  // The table starts at the text column, not pushed right like an indent.
  const offset = await editor(page)
    .locator("table")
    .evaluate((table) => {
      const root = document.querySelector("[data-slate-editor]")!;
      const textLeft =
        root.getBoundingClientRect().left + parseFloat(getComputedStyle(root).paddingLeft);
      const firstCell = table.querySelector("[data-table-cell-id]")!;
      return Math.round(firstCell.getBoundingClientRect().left - textLeft);
    });
  expect(Math.abs(offset)).toBeLessThanOrEqual(2);
});

test("saved widths are applied, and the comment holding them is not shown", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      "Tables.md":
        "# Tables\n\n<!-- netherstone: widths 100 300 100 -->\n\n| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n\nAfter.\n",
    },
    open: "Tables.md",
  });

  const [measure] = await measureTables(page);
  expect(measure.columns.map((w) => Math.round(w / 10) * 10)).toEqual([100, 300, 100]);
  await expect(editor(page).getByText("netherstone:")).toHaveCount(0);

  await caretAfter(page, "After.");
  await page.keyboard.type(" Edited.");
  const saved = await lastSave(page, "Tables.md");
  expect(saved).toContain("<!-- netherstone: widths 100 300 100 -->\n\n| a | b | c |");
});

test("dragging a column edge keeps the measured widths and saves them", async ({
  page,
}) => {
  await mockVault(page, { files: { "Tables.md": TABLE_NOTE }, open: "Tables.md" });

  const [before] = await measureTables(page);
  const firstCell = cellsOf(editor(page).locator("table tr").first()).first();
  await firstCell.hover();
  const handle = firstCell.locator(".cursor-col-resize").first();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const [after] = await measureTables(page);
  expect(after.columns[0]).toBeGreaterThan(before.columns[0] + 20);
  expect(Math.abs(after.tableWidth - before.tableWidth)).toBeLessThan(12);

  const saved = await lastSave(page, "Tables.md");
  expect(saved).toMatch(/<!-- netherstone: widths \d+ \d+ \d+ -->\n\n\| Name/);
});

test("a table that fills the text column does not scroll while in use", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      "Tables.md": `# Tables

| Name | Notes |
| - | - |
| Two words | A whole paragraph of text that is much longer than the cell next to it, so this column should take most of the room and wrap inside the text column. |

After.
`,
    },
    open: "Tables.md",
  });

  await caretAfter(page, "Two words");
  await expect(editor(page).locator(".cursor-col-resize").first()).toBeVisible();
  expect(await scrollsSideways(page)).toBe(false);
});

test("saved widths wider than the text column shrink to fit it", async ({ page }) => {
  await mockVault(page, {
    files: {
      "Tables.md":
        "# Tables\n\n<!-- netherstone: widths 300 600 300 -->\n\n| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |\n\nAfter.\n",
    },
    open: "Tables.md",
  });

  const [measure] = await measureTables(page);
  const total = measure.columns.reduce((sum, width) => sum + width, 0);
  expect(total).toBeLessThanOrEqual(measure.editorWidth);
  expect(total).toBeGreaterThan(measure.editorWidth - 8);
  // The columns keep their proportions.
  expect(Math.abs(measure.columns[1] - measure.columns[0] * 2)).toBeLessThan(4);
  expect(await scrollsSideways(page)).toBe(false);
});

test("dragging the last column's edge stops at the text column", async ({ page }) => {
  await mockVault(page, {
    files: {
      "Tables.md":
        "# Tables\n\n<!-- netherstone: widths 200 200 -->\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter.\n",
    },
    open: "Tables.md",
  });

  const lastCell = cellsOf(editor(page).locator("table tr").first()).last();
  await lastCell.hover();
  const handle = lastCell.locator(".cursor-col-resize").first();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 900, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  const [measure] = await measureTables(page);
  const total = measure.columns.reduce((sum, width) => sum + width, 0);
  expect(total).toBeLessThanOrEqual(measure.editorWidth);
  expect(total).toBeGreaterThan(measure.editorWidth - 16);
  expect(await scrollsSideways(page)).toBe(false);
});

test("a very wide table scrolls sideways instead of squeezing its columns", async ({
  page,
}) => {
  const header = Array.from({ length: 14 }, (_, i) => `Column ${i + 1}`);
  const markdown =
    `# Wide\n\n| ${header.join(" | ")} |\n| ${header.map(() => "-").join(" | ")} |\n| ${header
      .map((_, i) => `cell ${i + 1}`)
      .join(" | ")} |\n`;
  await mockVault(page, { files: { "Wide.md": markdown }, open: "Wide.md" });

  const [measure] = await measureTables(page);
  expect(measure.tableWidth).toBeGreaterThan(measure.editorWidth);
  expect(Math.min(...measure.columns)).toBeGreaterThanOrEqual(64);
  const scrolls = await editor(page)
    .locator("table")
    .evaluate((table) => {
      const wrapper = table.closest("[data-slate-node='element']") as HTMLElement;
      return wrapper.scrollWidth > wrapper.clientWidth && getComputedStyle(wrapper).overflowX === "auto";
    });
  expect(scrolls).toBe(true);
});

test("the table toolbar and resize handles exist only for the table in use", async ({
  page,
}) => {
  await mockVault(page, {
    files: { "Tables.md": `${TABLE_NOTE}\n| x | y |\n| - | - |\n| 1 | 2 |\n` },
    open: "Tables.md",
  });

  const tables = editor(page).locator("table");
  await expect(tables).toHaveCount(2);
  const popover = page.locator("[data-slot='popover-content']");
  const handles = editor(page).locator(".cursor-col-resize");

  // Nothing is in use yet: no toolbar, and no handles on any cell.
  await expect(popover).toHaveCount(0);
  await expect(handles).toHaveCount(0);

  await caretAfter(page, "Short");
  await expect(popover).toHaveCount(1);
  // Only the table with the caret carries handles: 3 rows, each with a
  // handle after every column.
  await expect(handles).toHaveCount(9);

  await caretAfter(page, "After the table.");
  await expect(popover).toHaveCount(0);
  await expect(handles).toHaveCount(0);

  await tables.nth(1).hover();
  await expect(handles).toHaveCount(4);
});

test("the table toolbar aligns the whole column, and the alignment is saved", async ({
  page,
}) => {
  await mockVault(page, { files: { "Tables.md": TABLE_NOTE }, open: "Tables.md" });

  await caretAfter(page, "Short");
  await page.getByRole("button", { name: "Align column" }).click();
  await page.getByRole("menuitemradio", { name: "Right" }).click();

  const table = editor(page).locator("table");
  for (const text of ["Description", "Short"]) {
    await expect(table.getByText(text, { exact: true })).toHaveCSS("text-align", "right");
  }
  await expect(table.getByText("Beta", { exact: true })).not.toHaveCSS("text-align", "right");

  const saved = await lastSave(page, "Tables.md");
  expect(saved).toMatch(/\| :?-+ +\| -+: +\| :?-+ +\|/);
});

test("the table toolbar waits while Settings covers the shard", async ({ page }) => {
  await mockVault(page, { files: { "Tables.md": TABLE_NOTE }, open: "Tables.md" });
  const popover = page.locator("[data-slot='popover-content']");

  await caretAfter(page, "Short");
  await expect(popover).toHaveCount(1);

  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await expect(popover).toHaveCount(0);

  await settings.click();
  await expect(popover).toHaveCount(1);
});
