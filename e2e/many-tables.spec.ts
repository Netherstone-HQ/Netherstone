import { caretAfter, editor, expect, lastSave, mockVault, openShard, test } from "./vault";

/**
 * A shard with hundreds of tables must still open and take typing. The
 * budgets are loose on purpose: CI runners are slow and shared, so the
 * numbers only catch a collapse, not a regression of a few percent. The
 * measured times are printed for the perf/table-rendering work.
 */

const SECTIONS = 400;

function manyTables() {
  let markdown = "# Big\n\n";
  for (let i = 0; i < SECTIONS; i += 1) {
    markdown +=
      `## Section ${i}\n\nParagraph ${i} with **bold**, _italic_, \`code\` and a [link](https://example.com/${i}).\n\n` +
      `- item a\n- item b\n\n| a | b | c |\n| - | - | - |\n| ${i} | x | y |\n\n`;
  }
  return markdown;
}

test("a shard with 400 tables opens and takes edits", async ({ page }) => {
  test.slow();
  await mockVault(page, {
    files: { "Small.md": "# Small\n\nHi\n", "Big.md": manyTables() },
    open: "Small.md",
  });
  await expect(editor(page)).toContainText("Hi");

  const started = Date.now();
  await openShard(page, "Big");
  await editor(page).getByText("Paragraph 0 with").waitFor({ timeout: 60_000 });
  const openMs = Date.now() - started;

  await caretAfter(page, "Paragraph 0 with");
  const typingStarted = Date.now();
  await page.keyboard.type(" xxxxx", { delay: 50 });
  await expect(editor(page)).toContainText("xxxxx");
  const typingMs = Date.now() - typingStarted;

  console.log(`[many-tables] open ${openMs} ms, typing ${typingMs} ms`);
  expect(openMs).toBeLessThan(45_000);
  expect(typingMs).toBeLessThan(15_000);

  const saved = await lastSave(page, "Big.md");
  expect(saved).toContain("xxxxx");
  expect(saved.match(/^\| -+ \| -+ \| -+ \|$/gm)).toHaveLength(SECTIONS);
});

test("blocks far down a long shard show their drag handle", async ({ page }) => {
  test.slow();
  await mockVault(page, {
    files: { "Small.md": "# Small\n\nHi\n", "Big.md": manyTables() },
    open: "Small.md",
  });
  await expect(editor(page)).toContainText("Hi");
  await openShard(page, "Big");

  // Past the first chunks of 100 blocks, which clipped the gutter.
  const block = editor(page).getByText("Paragraph 300 with");
  await block.scrollIntoViewIfNeeded();
  await block.hover();

  const handle = page.locator("[data-plate-prevent-deselect]").first();
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  // Something actually painted there, not clipped away: the handle is what
  // the page reports at its own centre.
  const hit = await page.evaluate(
    ({ x, y }) => !!document.elementFromPoint(x, y)?.closest("[data-plate-prevent-deselect]"),
    { x: box.x + box.width / 2, y: box.y + box.height / 2 },
  );
  expect(hit).toBe(true);
});
