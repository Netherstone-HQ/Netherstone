import { expect, test } from "@playwright/test";
import {
  caretAfter,
  cellsOf,
  editor,
  lastSave,
  measureTables,
  mockVault,
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

test("a table without saved widths fills the text column and sizes by content", async ({
  page,
}) => {
  await mockVault(page, { files: { "Tables.md": TABLE_NOTE }, open: "Tables.md" });

  const [measure] = await measureTables(page);
  expect(measure.tableWidth).toBeGreaterThanOrEqual(measure.editorWidth * 0.9);
  // The long description gets most of the room.
  expect(measure.columns[1]).toBeGreaterThan(measure.columns[0] * 2);
  expect(Math.min(...measure.columns)).toBeGreaterThanOrEqual(64);
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
  // handle after every column and one before the first.
  await expect(handles).toHaveCount(12);

  await caretAfter(page, "After the table.");
  await expect(popover).toHaveCount(0);
  await expect(handles).toHaveCount(0);

  await tables.nth(1).hover();
  await expect(handles).toHaveCount(6);
});
