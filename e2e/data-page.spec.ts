import type { Page } from "@playwright/test";
import { editor, expect, mockVault, test, VAULT_PATH } from "./vault";

const TABLE = [
  "| Week   | km | Runs |",
  "| ------ | -- | ---- |",
  "| Sep 7  | 11 | 3    |",
  "| Sep 14 | 9  | 2    |",
  "| Sep 21 | 15 | 3    |",
].join("\n");

const FILES = {
  "Note.md": "# Note\n\nStart\n",
  // The link and the missing photo sit below the fold, so opening them has
  // to scroll.
  "Spaced repetition.md": `# Spaced repetition\n\n${"Filler.\n\n".repeat(80)}See [Leitner box](Leitner%20box.md).\n`,
  "Trip.md": `# Trip\n\n${"Filler.\n\n".repeat(80)}![photo.png](_attachments/photo.png)\n`,
  // The second chart sits below the fold.
  "Running log.md": `# Running log\n\n${TABLE}\n\n<!-- netherstone chart: bar; x Week; y km; title Distance -->\n\n${"Filler.\n\n".repeat(80)}${TABLE}\n\n<!-- netherstone chart: line; x Week; y Runs; title Runs -->\n`,
};

function today(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Answers the Overview page's commands. Registered before `mockVault`, so it
 * wraps the mocked bridge as that one installs it.
 */
async function mockData(
  page: Page,
  data: {
    entries: unknown[];
    startedOn: string;
    brokenLinks: unknown[];
    missing?: unknown[];
    unused?: unknown[];
    charts?: unknown[];
  },
) {
  await page.addInitScript((data) => {
    type Bridge = { invoke: (command: string, args?: unknown) => unknown };
    let bridge: Bridge | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      get: () => bridge,
      set: (value: Bridge) => {
        const invoke = value.invoke;
        value.invoke = async (command, args) => {
          if (command === "get_writing_log") {
            return {
              shard_count: 2,
              word_count: 1234,
              started_on: data.startedOn,
              entries: data.entries,
            };
          }
          if (command === "get_broken_links") return data.brokenLinks;
          if (command === "get_charts") return data.charts ?? [];
          if (command === "reconcile_attachments") {
            return {
              fileCount: 0,
              totalBytes: 0,
              missing: data.missing ?? [],
              unused: data.unused ?? [],
              registeredCount: 0,
              removedShardCount: 0,
              externalFiles: [],
            };
          }
          return invoke(command, args);
        };
        bridge = value;
      },
    });
  }, data);
}

function entry(day: string, name: string, words: number, exists = true) {
  return {
    day,
    path: `${VAULT_PATH}/${name}`,
    name,
    words,
    exists,
    has_history: !exists,
  };
}

test("the Overview page shows the days written and the broken links", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(-40),
    entries: [
      entry(today(-3), "Note.md", 120),
      entry(today(), "Spaced repetition.md", 412),
    ],
    brokenLinks: [
      {
        text: "Leitner box",
        path: `${VAULT_PATH}/Spaced repetition.md`,
        name: "Spaced repetition.md",
      },
    ],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Writing" })).toBeVisible();
  await expect(page.getByText("1,234", { exact: true })).toBeVisible();

  // Opens on the last day written.
  await expect(page.getByText("+412 words")).toBeVisible();
  await page.getByRole("button", { name: /: 120 words$/ }).click();
  await expect(page.getByText("+120 words")).toBeVisible();

  await expect(page.getByText("@Leitner box")).toBeVisible();
  await page.getByRole("button", { name: /@Leitner box/ }).click();
  await expect(page.getByRole("button", { name: "Editor" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  // The shard opens scrolled to the broken link, with it selected.
  const link = page.locator('[data-slate-value="Leitner box"]');
  await expect(link).toBeInViewport();
  await expect(link).toHaveClass(/ring-2/);
});

test("a vault with no writing yet starts its calendar today", async ({
  page,
}) => {
  await mockData(page, { startedOn: today(), entries: [], brokenLinks: [] });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  await expect(page.getByText("Your calendar starts today")).toBeVisible();
  await expect(page.getByText("Nothing needs attention.")).toBeVisible();
  // No charts, no Charts section.
  await expect(page.getByRole("heading", { name: "Charts" })).toHaveCount(0);
});

test("a busy day lists six shards until you show all of them", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(-40),
    entries: [
      ...Array.from({ length: 8 }, (_, i) =>
        entry(today(), `Shard ${i + 1}.md`, 100 - i),
      ),
      entry(today(), "Gone.md", 500, false),
    ],
    brokenLinks: [],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  await expect(page.getByText("+100 words")).toBeVisible();
  await expect(page.getByText("+95 words")).toBeVisible();
  await expect(page.getByText("+94 words")).toHaveCount(0);
  // Deleted shards come after the others, in their own group.
  const deleted = page.getByRole("list", { name: "Deleted" });
  await expect(deleted).toHaveCount(0);
  await page.getByRole("button", { name: "Show all 9" }).click();
  await expect(page.getByText("+93 words")).toBeVisible();
  await expect(deleted.getByText("+500 words")).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all 9" })).toHaveCount(0);
});

test("the calendar shows the last year across the card's width", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(-400),
    entries: [entry(today(), "Note.md", 10)],
    brokenLinks: [],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  const calendar = page.getByRole("group", { name: "Days written" });
  await expect(calendar).toBeVisible();
  await expect(page.getByRole("button", { name: /^Show the/ })).toHaveCount(0);
  // 53 weeks, never scrolled sideways.
  const days = await calendar.getByRole("button").count();
  expect(days).toBeGreaterThan(52 * 7);
  const overflow = await calendar.evaluate(
    (el) => el.scrollWidth - el.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

/** A chart of `TABLE`, as `get_charts` sends it. */
function chart(name: string, index: number, comment: string) {
  const [columns, , ...rows] = TABLE.split("\n").map((line) =>
    line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim()),
  );
  return { path: `${VAULT_PATH}/${name}`, name, index, comment, columns, rows };
}

test("charts are drawn small and open their shard at the chart", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(),
    entries: [],
    brokenLinks: [],
    charts: [
      chart("Running log.md", 0, "<!-- netherstone chart: bar; x Week; y km; title Distance -->"),
      chart("Running log.md", 1, "<!-- netherstone chart: line; x Week; y Runs; title Runs -->"),
      chart("Budget.md", 0, "<!-- netherstone chart: bar -->"),
      chart("Reading.md", 0, "<!-- netherstone chart: line; y km -->"),
      chart("Garden.md", 0, "<!-- netherstone chart: bar; y Runs -->"),
    ],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  const charts = page.getByRole("region", { name: "Charts" });
  // The four last edited, each drawn, until you show all of them.
  await expect(charts.getByRole("img")).toHaveCount(4);
  await expect(charts.getByRole("img", { name: "Distance" }).locator("path")).toHaveCount(3);
  await charts.getByRole("button", { name: "Show all 5" }).click();
  await expect(charts.getByRole("img")).toHaveCount(5);
  await expect(charts.getByRole("button", { name: /^Show all/ })).toHaveCount(0);

  await charts.getByRole("button", { name: /^Running log Runs/ }).click();
  await expect(page.getByRole("button", { name: "Editor" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(editor(page).getByRole("img", { name: "Runs" })).toBeInViewport();
});

test("the sidebar lists the vault's shards, as in the Editor", async ({
  page,
}) => {
  await mockData(page, { startedOn: today(), entries: [], brokenLinks: [] });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  await expect(page.getByRole("region", { name: "On this page" })).toHaveCount(0);
  await page
    .getByRole("region", { name: "Files" })
    .getByRole("button", { name: "Trip", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "Editor" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(editor(page).getByText("Trip", { exact: true })).toBeVisible();
});

test("Health groups what needs fixing, each with its count", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(),
    entries: [],
    brokenLinks: [
      { text: "Gone", path: `${VAULT_PATH}/Note.md`, name: "Note.md" },
      { text: "Lost", path: `${VAULT_PATH}/Note.md`, name: "Note.md" },
    ],
    missing: [
      {
        assetPath: "_attachments/photo.png",
        shardPaths: [`${VAULT_PATH}/Trip.md`],
        originalName: "photo.png",
        foundAssetPath: "_attachments/photo-1.png",
      },
    ],
    unused: [
      { assetPath: "_attachments/new.png", sizeBytes: 2048, unusedSince: Math.floor(Date.now() / 1000) },
    ],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  const health = page.getByRole("region", { name: "Health" });
  await expect(health.getByRole("list", { name: "Broken links" }).getByRole("button")).toHaveCount(2);
  await expect(health.getByRole("list", { name: "Missing files" }).getByRole("button", { name: "Relink" })).toBeVisible();
  await expect(health.getByRole("list", { name: "Unused files" }).getByText("new.png")).toBeVisible();
  // Too new to clean up yet.
  await expect(health.getByRole("button", { name: "Clean up" })).toHaveCount(0);
  await expect(health.getByText("Clean up in 7 days")).toBeVisible();
  await expect(health.getByText("Open", { exact: true })).toHaveCount(0);
});

test("the picked day sits beside the calendar when wide, under it when narrow", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(-40),
    entries: [entry(today(), "Note.md", 10)],
    brokenLinks: [],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  const writing = page.getByRole("region", { name: "Writing" });
  const day = page.getByRole("region", { name: /^\w+, / });
  await expect(day.getByText("+10 words")).toBeVisible();

  const wide = [await writing.boundingBox(), await day.boundingBox()];
  expect(wide[1]!.x).toBeGreaterThan(wide[0]!.x + wide[0]!.width);

  await page.setViewportSize({ width: 1024, height: 800 });
  await expect
    .poll(async () => (await day.boundingBox())!.y)
    .toBeGreaterThan((await writing.boundingBox())!.y + (await writing.boundingBox())!.height);
  const narrow = [await writing.boundingBox(), await day.boundingBox()];
  expect(narrow[1]!.x).toBeCloseTo(narrow[0]!.x, 0);
});

test("unused files are cleaned up from Health", async ({ page }) => {
  const longAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  await mockData(page, {
    startedOn: today(),
    entries: [],
    brokenLinks: [],
    unused: [
      { assetPath: "_attachments/old.png", sizeBytes: 2048, unusedSince: longAgo },
    ],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  await expect(
    page.getByRole("list", { name: "Unused files" }).getByText("old.png"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Clean up" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "Move 1 unused file to trash?" }),
  ).toBeVisible();
});

test("a missing file opens its shard at the embed", async ({ page }) => {
  await mockData(page, {
    startedOn: today(),
    entries: [],
    brokenLinks: [],
    missing: [
      {
        assetPath: "_attachments/photo.png",
        shardPaths: [`${VAULT_PATH}/Trip.md`],
        originalName: "photo.png",
        foundAssetPath: null,
      },
    ],
  });
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.keyboard.press("Control+5");
  const row = page.getByRole("button", { name: /^photo\.png in Trip/ });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole("button", { name: "Editor" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("photo.png", { exact: true })).toBeInViewport();
});

test("a deleted shard opens its last version, and restoring brings it back", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(-40),
    entries: [entry(today(), "Old idea.md", 30, false)],
    brokenLinks: [],
  });
  await mockVault(page, {
    files: FILES,
    open: "Note.md",
    versions: {
      "Old idea.md": [
        { time: Math.floor(Date.now() / 1000), content: "# Old idea\n\nKept text\n" },
      ],
    },
  });

  await page.keyboard.press("Control+5");
  await page.getByRole("button", { name: /^Old idea/ }).click();
  const history = page.getByRole("complementary", { name: "History" });
  await expect(history).toBeVisible();
  // No "Now": the shard is gone, its last version shows.
  await expect(history.getByText("Now")).toHaveCount(0);
  await expect(page.getByText("Kept text")).toBeVisible();
  await expect(page.getByText("Show changes")).toHaveCount(0);

  await page.getByRole("button", { name: "Restore this version" }).click();
  await expect(history).toHaveCount(0);
  await expect(
    page.getByRole("textbox").getByText("Kept text"),
  ).toBeVisible();
  const saves = await page.evaluate(() => window.__saves);
  expect(saves).toContainEqual({
    filePath: `${VAULT_PATH}/Old idea.md`,
    content: "# Old idea\n\nKept text\n",
  });
});
