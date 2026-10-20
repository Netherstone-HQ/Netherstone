import type { Page } from "@playwright/test";
import { expect, mockVault, test, VAULT_PATH } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart\n",
  // The link and the missing photo sit below the fold, so opening them has
  // to scroll.
  "Spaced repetition.md": `# Spaced repetition\n\n${"Filler.\n\n".repeat(80)}See [Leitner box](Leitner%20box.md).\n`,
  "Trip.md": `# Trip\n\n${"Filler.\n\n".repeat(80)}![photo.png](_attachments/photo.png)\n`,
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
          if (command === "get_chart_shards") return [];
          if (command === "reconcile_attachments") {
            return {
              fileCount: 0,
              totalBytes: 0,
              missing: data.missing ?? [],
              unused: [],
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

  await page.keyboard.press("Control+4");
  await expect(page.getByText("Your calendar starts today")).toBeVisible();
  await expect(page.getByText("No broken links.")).toBeVisible();
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

  await page.keyboard.press("Control+4");
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

  await page.keyboard.press("Control+4");
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
