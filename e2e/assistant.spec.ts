import { editor, expect, mockVault, test } from "./vault";

/**
 * The assistant panel, in the right sidebar's place: its states before a
 * chat can start, sending with shards, cited answers and saved chats.
 */

const FILES = {
  "Trip.md": "# Trip\n\n## Plans\n\nLisbon in May, by train.\n",
  "Bread.md": "# Bread\n\nUse 350 g water.\n",
};

const READY = {
  provider: true,
  vaultAllowed: true,
  picked: true,
  answer: ["We go to Lisbon ", "in May [Trip](Trip.md#Plans)."],
  reads: ["Trip.md"],
};

const panel = (page: import("@playwright/test").Page) =>
  page.getByRole("complementary", { name: "Assistant" });

test("has no button while the assistant is off", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md" });
  await expect(editor(page)).toContainText("Lisbon");
  await expect(page.getByRole("button", { name: "Show history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show assistant" })).toHaveCount(0);
});

test("asks for a provider, then for the vault", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: {} });
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(panel(page).getByText("No AI provider set up")).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: "Message" })).toBeDisabled();
  await panel(page).getByRole("button", { name: "Set up" }).click();
  await expect(page.getByRole("switch", { name: "Turn on the assistant" })).toBeVisible();
});

test("turns the vault on for AI from the panel", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, vaultAllowed: false },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(panel(page).getByText("Vault is off for AI")).toBeVisible();
  await panel(page).getByRole("button", { name: "Turn on" }).click();
  await expect(panel(page).getByRole("button", { name: "Summarize this shard" })).toBeVisible();
});

test("asks for a model, and picks one from the panel", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, picked: false },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(panel(page).getByText("No model picked")).toBeVisible();
  await panel(page).getByRole("button", { name: "Pick a model" }).first().click();
  await page.getByRole("option", { name: "Claude Sonnet 5.5" }).click();
  await expect(panel(page).getByRole("button", { name: "Model" })).toHaveText(
    /Claude Sonnet 5\.5\s*Anthropic/,
  );
});

test("answers with the open shard, cited", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await expect(assistant.getByText("Trip", { exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();

  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();
  expect(await page.evaluate(() => window.__sent)).toEqual([
    { chat: null, text: "Summarize this shard", shards: ["Trip.md"] },
  ]);
  // The cited shard, numbered in the text and listed with its section.
  await expect(assistant.getByRole("button", { name: "Open Trip.md" })).toHaveText("1");
  const source = assistant.getByRole("button", { name: /^1\s*Trip\s*Plans$/ });
  await expect(source).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Chats" })).toHaveText(
    "Summarize this shard",
  );

  // A source opens its shard.
  await page.getByText("Bread", { exact: true }).first().click();
  await expect(editor(page)).toContainText("350 g");
  await source.click();
  await expect(editor(page)).toContainText("Lisbon");
});

test("adds shards with @", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Remove Trip from this message" }).click();
  const message = assistant.getByRole("textbox", { name: "Message" });
  await message.fill("How much water? @Bre");
  const option = assistant.getByRole("option", { name: "Bread" });
  await expect(option).toHaveAttribute("aria-selected", "true");
  await message.press("Enter");
  await expect(assistant.getByRole("button", { name: "Remove Bread from this message" })).toBeVisible();
  await expect(message).toHaveValue("How much water? ");
  await message.press("Enter");
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();
  expect(await page.evaluate(() => window.__sent)).toEqual([
    { chat: null, text: "How much water?", shards: ["Bread.md"] },
  ]);
});

test("lists saved chats, and deletes them all after asking", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();

  await assistant.getByRole("button", { name: "New chat" }).click();
  await expect(assistant.getByRole("button", { name: "Chats" })).toHaveText("New chat");
  await assistant.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("menuitem", { name: /Summarize this shard/ }).click();
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();
  // A menu still closing takes the next click as one outside it.
  await expect(page.getByRole("menu")).toHaveCount(0);

  await assistant.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("menuitem", { name: "Delete all chats" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete all" }).click();
  await expect(assistant.getByRole("button", { name: "Chats" })).toHaveText("New chat");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await assistant.getByRole("button", { name: "Chats" }).click();
  await expect(page.getByText("No saved chats")).toBeVisible();
});

test("swaps places with History", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(panel(page)).toBeVisible();
  await page.getByRole("button", { name: "Show history" }).click();
  await expect(page.getByRole("complementary", { name: "History" })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(panel(page)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "History" })).toHaveCount(0);
});
