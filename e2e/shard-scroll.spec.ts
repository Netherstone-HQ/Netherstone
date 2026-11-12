import type { Page } from "@playwright/test";
import { caretAfter, editor, expect, mockVault, openShard, test, VAULT_PATH } from "./vault";

/**
 * Each shard keeps its own place: switching away and back, and restarting
 * the app, opens it where it was left. Long shards are drawn a part at a
 * time, so this also covers coming back to a part not drawn yet.
 */

const SECTIONS = 300;

function longShard() {
  let markdown = "# Long\n\n";
  for (let i = 0; i < SECTIONS; i += 1) {
    markdown += `## Section ${i}\n\n| a | b |\n| - | - |\n| ${i} | row ${i} |\n\n`;
  }
  return markdown;
}

const heading = (page: Page, i: number) =>
  editor(page).getByRole("heading", { name: `Section ${i}`, exact: true });

/** How far below the top of the editor's scroll area `i`'s heading is. */
async function headingTop(page: Page, i: number) {
  return heading(page, i).evaluate((el) => {
    const main = el.closest("main")!;
    return el.getBoundingClientRect().top - main.getBoundingClientRect().top;
  });
}

async function scrollToSection(page: Page, i: number) {
  await heading(page, i).evaluate((el) => el.scrollIntoView({ block: "start" }));
  // The place is written down once scrolling pauses.
  await expect
    .poll(() =>
      page.evaluate(
        (path) =>
          JSON.parse(localStorage.getItem("netherstone-shard-scroll") ?? "{}")
            .state?.positions?.[path]?.block ?? 0,
        `${VAULT_PATH}/Long.md`,
      ),
    )
    .toBeGreaterThanOrEqual(2 * i);
}

test.beforeEach(async ({ page }) => {
  await mockVault(page, {
    files: { "Small.md": "# Small\n\nHi\n", "Long.md": longShard() },
    open: "Small.md",
  });
  await expect(editor(page)).toContainText("Hi");
  await openShard(page, "Long");
  await expect(heading(page, 0)).toBeVisible();
});

test("a shard opens where it was left, and another one at its top", async ({ page }) => {
  await scrollToSection(page, 200);
  const top = await headingTop(page, 200);

  await openShard(page, "Small");
  await expect(editor(page)).toContainText("Hi");
  const scrollTop = await editor(page).evaluate((el) => el.closest("main")!.scrollTop);
  expect(scrollTop).toBe(0);

  await openShard(page, "Long");
  await expect(heading(page, 200)).toBeInViewport({ timeout: 30_000 });
  expect(Math.abs((await headingTop(page, 200)) - top)).toBeLessThan(4);
});

test("a shard opens where it was left after a restart", async ({ page }) => {
  await scrollToSection(page, 250);
  const top = await headingTop(page, 250);

  await page.reload();
  await page.locator("[data-slate-editor]").first().waitFor();
  await openShard(page, "Long");

  // Opening a long shard is slow on a busy test runner.
  await expect(heading(page, 250)).toBeInViewport({ timeout: 30_000 });
  expect(Math.abs((await headingTop(page, 250)) - top)).toBeLessThan(4);
});

test("the place comes back when the window is restored", async ({ page }) => {
  await scrollToSection(page, 120);
  const top = await headingTop(page, 120);
  const size = page.viewportSize()!;

  // A minimized window leaves the editor no height.
  await page.setViewportSize({ width: size.width, height: 1 });
  // Observers are told in the order they started, so once this one sees no
  // height, the editor's own has too.
  await editor(page).evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const main = el.closest("main")!;
        const seen = new ResizeObserver(() => {
          if (main.clientHeight >= 1) return;
          seen.disconnect();
          resolve();
        });
        seen.observe(main);
      }),
  );
  await page.setViewportSize(size);

  await expect(heading(page, 120)).toBeInViewport();
  expect(Math.abs((await headingTop(page, 120)) - top)).toBeLessThan(4);
});

test("the whole shard is drawn after opening", async ({ page }) => {
  await expect(heading(page, SECTIONS - 1)).toBeAttached({ timeout: 30_000 });
  await expect(editor(page).locator("[data-undrawn-chunk]")).toHaveCount(0);
});

// The shard ends with a table, where the browser's own Ctrl+End left no caret.
test("Ctrl+End right after opening goes to the very end", async ({ page }) => {
  await caretAfter(page, "Section 0");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("!");
  await expect(editor(page).getByText(`row ${SECTIONS - 1}!`)).toBeInViewport();
});

test("Ctrl+End in a drawn shard that ends with a table goes into its last cell", async ({
  page,
}) => {
  await expect(editor(page).locator("[data-undrawn-chunk]")).toHaveCount(0, { timeout: 30_000 });
  await caretAfter(page, "Section 0");
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("!");
  await expect(editor(page).getByText(`row ${SECTIONS - 1}!`)).toBeInViewport();
});

test("Select all right after opening takes the whole shard", async ({ page }) => {
  await caretAfter(page, "Section 0");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  await expect(editor(page)).not.toContainText(`row ${SECTIONS - 1}`);
  await expect(editor(page)).not.toContainText("Long");
});
