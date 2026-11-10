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
  await expect(
    editor(page).getByRole("img", { name: "km, Runs by Week" }),
  ).toBeVisible();

  const saved = await lastSave(page, "Running log.md");
  expect(saved).toContain(
    "<!-- netherstone chart: bar; x Week; y km, Runs -->",
  );
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

  await expect(
    editor(page).getByRole("img", { name: "km by Week" }),
  ).toBeVisible();
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

test("a chart under a table with an empty header opens its settings", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      "Costs.md": `# Costs\n\n|  | Today | Later |\n| - | ----- | ----- |\n| Tokens | about 15,000 | about 38,000 |\n| Runs | 3 | 5 |\n\n<!-- netherstone chart: bar -->\n`,
    },
    open: "Costs.md",
  });

  await editor(page).locator("[data-chart]").hover();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("combobox").click();
  await expect(page.getByRole("option")).toHaveText([
    "Column 1",
    "Today",
    "Later",
  ]);
  await page.keyboard.press("Escape");
  await expect(page.getByText("The editor ran into an error.")).toHaveCount(0);
  await expect(
    editor(page).getByRole("img", { name: "Today by Column 1" }),
  ).toBeVisible();
});

test("a selected chart in a long shard keeps its ring on screen", async ({
  page,
}) => {
  // Long shards draw in parts, each clipped to its own box.
  const lines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`);
  await mockVault(page, {
    files: {
      "Running log.md": `# Running log\n\n${lines.join("\n\n")}\n\n${TABLE}\n\n<!-- netherstone chart: bar; x Week; y km -->\n`,
    },
    open: "Running log.md",
  });

  const chart = editor(page).locator("[data-chart]");
  await chart.click();
  await expect(chart).toHaveClass(/ring-2/);
  const [chartRight, ring, partRight] = await chart.evaluate((element) => {
    const part = element.closest("[data-slate-chunk]");
    const style = getComputedStyle(element);
    return [
      element.getBoundingClientRect().right,
      parseFloat(style.getPropertyValue("--tw-ring-offset-width")) + 2,
      part?.getBoundingClientRect().right ?? Number.NaN,
    ];
  });
  expect(partRight).toBeGreaterThanOrEqual(chartRight + ring);
});
