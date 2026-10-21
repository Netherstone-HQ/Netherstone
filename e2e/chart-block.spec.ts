import { caretAfter, editor, expect, lastSave, mockVault, test } from "./vault";

const TABLE = [
  "| Week   | km | Runs |",
  "| ------ | -- | ---- |",
  "| Sep 7  | 11 | 3    |",
  "| Sep 14 | 9  | 2    |",
  "| Sep 21 | 15 | 3    |",
].join("\n");

test("a chart under a table draws its numbers and saves its settings", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      "Running log.md": `# Running log\n\n${TABLE}\n\n<!-- netherstone chart: bar; x Week; y km -->\n`,
    },
    open: "Running log.md",
  });

  const chart = editor(page).getByRole("img", { name: "km by Week" });
  await expect(chart).toBeVisible();
  await expect(chart.locator("path")).toHaveCount(3);

  await chart.locator("rect[fill='transparent']").nth(2).hover();
  await expect(page.getByText("Sep 21").last()).toBeVisible();

  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("radio", { name: "Line" }).click();
  await page.getByRole("checkbox").last().click();
  await page.keyboard.press("Escape");

  await expect(
    editor(page).getByRole("img", { name: "km, Runs by Week" }),
  ).toBeVisible();
  const saved = await lastSave(page, "Running log.md");
  expect(saved).toContain(
    "| Sep 21 | 15 | 3    |\n\n<!-- netherstone chart: line; x Week; y km, Runs -->",
  );
});

test("the table toolbar adds a chart of the table", async ({ page }) => {
  await mockVault(page, {
    files: { "Running log.md": `# Running log\n\n${TABLE}\n` },
    open: "Running log.md",
  });

  await caretAfter(page, "Sep 14");
  await page.getByRole("button", { name: "Add a chart of this table" }).click();
  await expect(editor(page).getByRole("img", { name: "km by Week" })).toBeVisible();

  const saved = await lastSave(page, "Running log.md");
  expect(saved).toContain("<!-- netherstone chart: bar; x Week; y km -->");
});

test("a chart written right under its table is drawn, not read as a row", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      "Running log.md": `# Running log\n\n${TABLE}\n<!-- netherstone chart: bar; x Week; y km -->\n`,
    },
    open: "Running log.md",
  });

  await expect(editor(page).getByRole("img", { name: "km by Week" })).toBeVisible();
  await expect(editor(page).locator("table tr")).toHaveCount(4);
});

test("a table with one column of numbers can't draw it along the bottom", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      "Words.md": `# Words\n\n| Month | Words |\n| ----- | ----- |\n| July  | 4200  |\n| Aug   | 6100  |\n\n<!-- netherstone chart: bar; x Month; y Words -->\n`,
    },
    open: "Words.md",
  });

  await editor(page).getByRole("img", { name: "Words by Month" }).hover();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("combobox").click();
  await expect(page.getByRole("option")).toHaveText(["Month"]);
  await page.keyboard.press("Escape");
  await expect(page.getByText("Numbers", { exact: true })).toHaveCount(0);
});
