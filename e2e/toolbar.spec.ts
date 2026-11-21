import {
  caretAfter,
  editor,
  expect,
  mockVault,
  select,
  test,
  textToolbar,
} from "./vault";

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

  await page.setViewportSize({ width: 800, height: 800 });
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

test("a toolbar opened narrow starts with buttons in the ⋯ menu", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 800 });
  const toolbar = await openShard(page);
  await expect(toolbar.locator("div[inert]:has(svg.lucide-bold)")).toHaveCount(1);
});

test("a narrow toolbar keeps every button that fits", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const toolbar = await openShard(page);
  // Buttons move one at a time, not a whole group at once.
  const moved = (icon: string) =>
    toolbar.locator(`div[inert]:has(svg.lucide-${icon})`);
  await expect(moved("highlighter")).toHaveCount(1);
  await expect(moved("bold")).toHaveCount(0);

  // The ⋯ menu stops short of the window's edge.
  await page.setViewportSize({ width: 700, height: 400 });
  await toolbar.locator("button:has(svg.lucide-ellipsis)").click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box!.y + box!.height).toBeLessThan(400);
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

const LONG = Array.from(
  { length: 60 },
  (_, i) => `Step ${i + 1}: knead the dough and let it rest.`,
).join("\n\n");

async function openLongShard(page: import("@playwright/test").Page) {
  await mockVault(page, {
    files: { "Bread.md": `# Bread\n\n${LONG}\n` },
    open: "Bread.md",
  });
  await expect(editor(page)).toContainText("Step 60");
}

/** Scrolls the shard to its end and returns where the toolbar's bar sits. */
async function scrollToEnd(page: import("@playwright/test").Page) {
  const main = page.locator("main");
  await main.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(editor(page).getByText("Step 60")).toBeInViewport();
  const bar = page.getByRole("toolbar").first().locator("..");
  return {
    main: (await main.boundingBox())!,
    bar: (await bar.boundingBox())!,
  };
}

test("the toolbar stays in view while a long shard scrolls", async ({ page }) => {
  await openLongShard(page);
  const { main, bar } = await scrollToEnd(page);
  expect(bar.y).toBeCloseTo(main.y, 0);

  // Text size is already on screen, so the selection toolbar leaves it out.
  await select(page, "Step 60: knead");
  await expect(textToolbar(page)).toBeVisible();
  await expect(textToolbar(page).locator("svg.lucide-plus")).toHaveCount(0);
});

test("with the toolbar unpinned, text size is in the selection toolbar", async ({
  page,
}) => {
  await openLongShard(page);
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await page
    .getByRole("navigation", { name: "Settings" })
    .getByRole("button", { name: "Editor" })
    .click();
  await page.getByRole("switch", { name: "Pin toolbar" }).click();
  await expect(page.getByRole("switch", { name: "Pin toolbar" })).not.toBeChecked();
  await settings.click();

  const { main, bar } = await scrollToEnd(page);
  expect(bar.y + bar.height).toBeLessThanOrEqual(main.y);

  await select(page, "Step 60: knead");
  const toolbar = textToolbar(page);
  await toolbar.locator("button:has(svg.lucide-plus)").click();
  await expect(
    editor(page).locator("[data-slate-node=text][style*='font-size: 17px']"),
  ).toHaveText("Step 60: knead");
  await expect(toolbar.locator("input")).toHaveValue("17");
});

test("the caret stops below the pinned toolbar, not under it", async ({ page }) => {
  await openLongShard(page);
  await caretAfter(page, "Step 40:");
  // Step 40 at the top of the shard's area, so moving up takes the caret
  // under the toolbar unless the shard scrolls.
  const main = page.locator("main");
  await main.evaluate((main) => {
    const step = [...main.querySelectorAll("[data-slate-node=element]")].find(
      (element) => element.textContent?.startsWith("Step 40:"),
    )!;
    main.scrollTop +=
      step.getBoundingClientRect().top - main.getBoundingClientRect().top;
  });
  const before = await main.evaluate((main) => main.scrollTop);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  expect(await main.evaluate((main) => main.scrollTop)).toBeLessThan(before);

  const bar = (await page.getByRole("toolbar").first().locator("..").boundingBox())!;
  const caretTop = await page.evaluate(
    () => getSelection()!.getRangeAt(0).getBoundingClientRect().top,
  );
  expect(caretTop).toBeGreaterThanOrEqual(bar.y + bar.height);
});
