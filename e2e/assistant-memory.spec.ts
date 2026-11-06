import { expect, mockVault, test } from "./vault";

/**
 * Memory: the assistant offers an item, Apply adds it and Undo takes it
 * back out, and Settings lists every item to edit or delete.
 */

const FILES = { "Trip.md": "# Trip\n\nLisbon in May, by train.\n" };

const READY = {
  provider: true,
  vaultAllowed: true,
  picked: true,
  answer: ["Will do. Want me to remember that for later chats too?"],
  remember: "I write in British English",
};

const panel = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Assistant" });

const memory = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__memory);

async function ask(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Show assistant" }).click();
  const box = panel(page).getByRole("textbox", { name: "Message" });
  await box.fill("Use British spelling from now on");
  await box.press("Enter");
  await expect(panel(page).getByText("Add to memory")).toBeVisible();
}

async function openMemorySettings(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "AI assistant" }).click();
}

test("adds an offered item only on Apply, and Undo takes it out", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await ask(page);
  const assistant = panel(page);
  await expect(assistant.getByText("I write in British English")).toBeVisible();
  expect(await memory(page)).toEqual([]);

  await assistant.getByRole("button", { name: "Apply" }).click();
  await expect(assistant.getByText("Added to memory")).toBeVisible();
  expect(await memory(page)).toEqual(["I write in British English"]);

  await assistant.getByRole("button", { name: "Undo" }).click();
  await expect(assistant.getByRole("button", { name: "Apply" })).toBeVisible();
  expect(await memory(page)).toEqual([]);
});

test("discards an offered item without adding it", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await ask(page);
  await panel(page).getByRole("button", { name: "Discard" }).click();
  await expect(panel(page).getByText("Add to memory")).toHaveCount(0);
  expect(await memory(page)).toEqual([]);
});

test("lists memory in Settings, to edit in place or delete", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, memory: ["I write in British English", "Keep answers short"] },
  });
  await openMemorySettings(page);
  const items = page.getByRole("list", { name: "Memory items" });
  await expect(items.getByRole("listitem")).toHaveCount(2);

  await items.getByRole("button", { name: "Edit" }).first().click();
  const input = items.getByRole("textbox", { name: "Memory item" });
  await input.fill("I write in British English, no Oxford comma");
  await items.getByRole("button", { name: "Save" }).click();
  await expect(items.getByText("I write in British English, no Oxford comma")).toBeVisible();

  await items.getByRole("button", { name: "Delete" }).last().click();
  await expect(items.getByRole("listitem")).toHaveCount(1);
  expect(await memory(page)).toEqual(["I write in British English, no Oxford comma"]);

  await page.getByRole("button", { name: "Delete all" }).nth(1).click();
  const dialog = page.getByRole("alertdialog", { name: "Delete all memory?" });
  await dialog.getByRole("button", { name: "Delete all" }).click();
  await expect(page.getByText("Nothing remembered yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete all" }).nth(1)).toBeDisabled();
  expect(await memory(page)).toEqual([]);
});

test("turning the assistant off drops an offer unsaved and keeps memory", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, memory: ["Keep answers short"] },
  });
  await ask(page);

  await openMemorySettings(page);
  await page.getByRole("switch", { name: "Turn on the assistant" }).click();
  await expect(page.getByRole("switch", { name: "Turn on the assistant" })).not.toBeChecked();

  // The list stays, and Settings still shows it.
  const items = page.getByRole("list", { name: "Memory items" });
  await expect(items.getByText("Keep answers short")).toBeVisible();

  // Turned back on, the chat has no offer left to apply.
  await page.getByRole("switch", { name: "Turn on the assistant" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(panel(page).getByText("Add to memory")).toHaveCount(0);
  expect(await memory(page)).toEqual(["Keep answers short"]);
  expect(
    await page.evaluate(() =>
      window.__commands.filter((c) => c.command === "assistant_remember").length,
    ),
  ).toBe(0);
});
