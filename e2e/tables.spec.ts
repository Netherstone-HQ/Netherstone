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
  expect(measure.tableWidth).toBeLessThanOrEqual(measure.editorWidth);
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
