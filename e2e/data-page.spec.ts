import type { Page } from "@playwright/test";
import { expect, mockVault, test, VAULT_PATH } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart\n",
  // The link sits below the fold, so opening it has to scroll.
  "Spaced repetition.md": `# Spaced repetition\n\n${"Filler.\n\n".repeat(80)}See [Leitner box](Leitner%20box.md).\n`,
};

function today(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Answers the Data page's commands. Registered before `mockVault`, so it
 * wraps the mocked bridge as that one installs it.
 */
async function mockData(
  page: Page,
  data: { entries: unknown[]; startedOn: string; brokenLinks: unknown[] },
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
          return invoke(command, args);
        };
        bridge = value;
      },
    });
  }, data);
}

test("the Data page shows the days written and the broken links", async ({
  page,
}) => {
  await mockData(page, {
    startedOn: today(-40),
    entries: [
      {
        day: today(-3),
        path: `${VAULT_PATH}/Note.md`,
        name: "Note.md",
        words: 120,
        exists: true,
      },
      {
        day: today(),
        path: `${VAULT_PATH}/Spaced repetition.md`,
        name: "Spaced repetition.md",
        words: 412,
        exists: true,
      },
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

  await page.getByRole("button", { name: "Data", exact: true }).click();
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
