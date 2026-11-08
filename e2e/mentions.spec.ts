import { caretAfter, editor, expect, lastSave, mockVault, pickOption, test } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart\n",
  "Other Note.md": "# Other Note\n\nContent.\n",
};

test("an @ link to another shard is inserted and saved as a link", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await caretAfter(page, "Start");
  await page.keyboard.type(" see @Oth");
  await pickOption(page, page.getByRole("option", { name: "Other Note" }));
  await page.keyboard.type(" now");

  await expect(editor(page)).toContainText("Other Note");

  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("Start see [Other Note](Other%20Note.md) now");
});

test("a relative link to a shard in a folder shows as an @ link and keeps its path", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      ...FILES,
      "Projects/Plan.md": "# Plan\n\nThe plan.\n",
      "Note.md": "# Note\n\nRead [the plan](Projects/Plan.md) first.\n",
    },
    open: "Note.md",
  });

  const chip = editor(page).locator("[data-slate-value='the plan']");
  await expect(chip).toBeVisible();

  await caretAfter(page, "first.");
  await page.keyboard.type(" Edited.");
  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("Read [the plan](Projects/Plan.md) first. Edited.");

  await chip.click();
  await expect(editor(page)).toContainText("The plan.");
});

test("an old mention: link still opens the linked shard, and saves as a relative link", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      ...FILES,
      "Note.md": "# Note\n\nSee [Other Note](mention:Other%20Note) now.\n",
    },
    open: "Note.md",
  });

  const chip = editor(page).getByText("Other Note", { exact: true }).first();
  await expect(chip).toBeVisible();

  await caretAfter(page, "now.");
  await page.keyboard.type(" Edited.");
  const saved = await lastSave(page, "Note.md");
  expect(saved).toContain("See [Other Note](Other%20Note.md) now. Edited.");

  await chip.click();
  await expect(editor(page)).toContainText("Content.");
});

test("a link shows it opens while Ctrl is held over it, and only that link changes", async ({
  page,
}) => {
  await mockVault(page, {
    files: {
      ...FILES,
      "Note.md": "# Note\n\nRead [the plan](https://plans.example) and [more](https://more.example).\n",
    },
    open: "Note.md",
  });
  const link = editor(page).getByRole("link", { name: "the plan" });
  const cursor = () => link.evaluate((el) => getComputedStyle(el).cursor);
  await link.hover();
  expect(await cursor()).toBe("text");
  await page.keyboard.down("ControlOrMeta");
  await expect.poll(cursor).toBe("pointer");
  // Pressing Ctrl, as for a paste, marks that link alone, so nothing else
  // in the shard is restyled.
  await expect(page.locator("[data-mod-held]")).toHaveCount(1);
  await expect(link).toHaveAttribute("data-mod-held");
  // Moving to another link with Ctrl held moves the mark.
  const more = editor(page).getByRole("link", { name: "more" });
  await more.hover();
  await expect(more).toHaveAttribute("data-mod-held");
  await expect(page.locator("[data-mod-held]")).toHaveCount(1);
  await link.hover();
  await page.keyboard.up("ControlOrMeta");
  await expect.poll(cursor).toBe("text");
});
