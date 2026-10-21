import { editor, expect, mockVault, test } from "./vault";

/**
 * The editor toolbar never scrolls: what doesn't fit moves into its ⋯ menu,
 * and the History header lines up with it.
 */

async function openShard(page: import("@playwright/test").Page) {
  await mockVault(page, {
    files: { "Bread.md": "# Bread\n\nUse 350 g water.\n" },
    open: "Bread.md",
  });
  await expect(editor(page)).toContainText("350 g");
  return page.getByRole("toolbar").first();
}

test("a narrow toolbar moves buttons into the ⋯ menu", async ({ page }) => {
  await page.setViewportSize({ width: 1800, height: 800 });
  const toolbar = await openShard(page);
  // A group that doesn't fit is clipped and inert.
  const boldMoved = toolbar.locator("div[inert]:has(svg.lucide-bold)");
  await expect(boldMoved).toHaveCount(0);

  await page.setViewportSize({ width: 1000, height: 800 });
  await expect(boldMoved).toHaveCount(1);
  expect(await toolbar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );

  // Bold from the menu applies to the selected text.
  await editor(page).getByText("Use 350 g water.").selectText();
  await toolbar.locator("button:has(svg.lucide-ellipsis)").click();
  const menu = page.getByRole("menu");
  await expect(
    menu.getByRole("menuitem", { name: "Superscript" }),
  ).toBeVisible();
  await menu.getByRole("menuitem", { name: "Bold" }).click();
  await expect(editor(page).locator("strong")).toHaveText("Use 350 g water.");

  // A dropdown button opens as a submenu.
  await page.setViewportSize({ width: 700, height: 800 });
  await toolbar.locator("button:has(svg.lucide-ellipsis)").click();
  await menu.getByRole("menuitem", { name: "Turn into" }).hover();
  await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
  await expect(editor(page).locator("h2")).toHaveText("Use 350 g water.");
});

test("the History header is as tall as the toolbar", async ({ page }) => {
  const toolbar = await openShard(page);
  await page.getByRole("button", { name: "Show history" }).click();
  const header = page
    .getByRole("complementary", { name: "History" })
    .getByText("History", { exact: true })
    .locator("..");
  const toolbarBox = await toolbar.locator("..").boundingBox();
  const headerBox = await header.boundingBox();
  expect(headerBox!.height).toBe(toolbarBox!.height);
  expect(headerBox!.y).toBe(toolbarBox!.y);
});
