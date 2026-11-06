import { caretAfter, editor, expect, mockVault, test } from "./vault";

/**
 * The assistant panel, in the right sidebar's place: its states before a
 * chat can start, sending with shards, cited answers and saved chats.
 */

const FILES = {
  "Trip.md": "# Trip\n\n## Plans\n\nLisbon in May, by train.\n",
  "Bread.md": "# Bread\n\nUse 350 g water.\n",
};

const EMPTY_DRAWING =
  '{"type":"excalidraw","version":2,"elements":[],"appState":{},"files":{}}';

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

test("names a new chat after its first answer", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, title: "Lisbon trip" },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(assistant.getByRole("button", { name: "Chats" })).toHaveText("Lisbon trip");
  await assistant.getByRole("button", { name: "Chats" }).click();
  await expect(page.getByRole("menuitem", { name: /Lisbon trip/ })).toBeVisible();
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

test("adds drawings with @", async ({ page }) => {
  await mockVault(page, {
    files: { ...FILES, "Route.excalidraw": EMPTY_DRAWING },
    open: "Trip.md",
    assistant: READY,
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  const message = assistant.getByRole("textbox", { name: "Message" });
  await message.fill("What's on @Rou");
  await assistant.getByRole("option", { name: "Route" }).click();
  await expect(assistant.getByRole("button", { name: "Remove Route from this message" })).toBeVisible();
  await message.press("Enter");
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();
  expect(await page.evaluate(() => window.__sent)).toEqual([
    { chat: null, text: "What's on", shards: ["Trip.md", "Route.excalidraw"] },
  ]);
});

test("lists saved chats, and deletes them all after asking", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();

  // A new chat lists the saved ones from its Chats button.
  await assistant.getByRole("button", { name: "New chat" }).click();
  await expect(assistant.getByText("New chat", { exact: true })).toBeVisible();
  await assistant.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("menuitem", { name: /Summarize this shard/ }).click();
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();
  // A menu still closing takes the next click as one outside it.
  await expect(page.getByRole("menu")).toHaveCount(0);

  await assistant.getByRole("button", { name: "Chats" }).click();
  await page.getByRole("menuitem", { name: "Delete all chats" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete all" }).click();
  // With none left, there's nothing to list.
  await expect(assistant.getByText("New chat", { exact: true })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Chats" })).toHaveCount(0);
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

const CHECKLIST = {
  path: "Trip.md",
  after: "# Trip\n\n## Plans\n\n- [x] Lisbon in May\n- [ ] By train\n",
};

const shardSaves = (page: import("@playwright/test").Page) =>
  page.evaluate(() => window.__saves.filter((save) => save.filePath.endsWith("/Trip.md")));

test("previews an edit in the shard, applies it, and undoes it", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, change: CHECKLIST },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();

  // The change shows in the shard, and nothing is written yet.
  await expect(assistant.getByText("1 change")).toBeVisible();
  const preview = page.getByLabel("Change to the shard");
  await expect(preview).toContainText("Lisbon in May, by train.");
  await expect(preview).toContainText("By train");
  await expect(preview.locator('[data-history-block="removed"]')).toHaveCount(1);
  await expect(preview.locator('[data-history-block="added"]')).toHaveCount(2);
  expect(await shardSaves(page)).toEqual([]);

  await assistant.getByRole("button", { name: "Apply" }).click();
  await expect(assistant.getByText("Applied to Trip")).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(editor(page)).toContainText("By train");
  await expect(editor(page)).not.toContainText("Lisbon in May, by train.");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(await shardSaves(page)).toEqual([
    { filePath: "/home/me/Vault/Trip.md", content: CHECKLIST.after },
  ]);

  // Undo puts the shard back, and the change can be applied again.
  await assistant.getByRole("button", { name: "Undo" }).click();
  await expect(assistant.getByRole("button", { name: "Apply" })).toBeVisible();
  await expect(preview).toContainText("Lisbon in May, by train.");
  expect((await shardSaves(page)).at(-1)?.content).toBe(FILES["Trip.md"]);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("keeps a shard link through the preview and Apply", async ({ page }) => {
  const linked = "# Trip\n\nBook it, see [Bread](Bread.md).\n";
  await mockVault(page, {
    files: { ...FILES, "Trip.md": linked },
    open: "Trip.md",
    assistant: {
      ...READY,
      change: { path: "Trip.md", after: "# Trip\n\n- [ ] Book it, see [Bread](Bread.md)\n" },
    },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();

  // The link shows as a link on both sides of the change.
  const preview = page.getByLabel("Change to the shard");
  for (const side of ["removed", "added"]) {
    await expect(
      preview.locator(`[data-history-block="${side}"] [data-slate-value="Bread"]`),
    ).toBeVisible();
  }

  await assistant.getByRole("button", { name: "Apply" }).click();
  await expect(assistant.getByText("Applied to Trip")).toBeVisible();
  await expect(editor(page).locator('[data-slate-value="Bread"]')).toBeVisible();

  // An edit after it saves the link as a link.
  await caretAfter(page, "Trip");
  await page.keyboard.type("s");
  await expect
    .poll(async () => (await shardSaves(page)).at(-1)?.content)
    .toBe("# Trips\n\n- [ ] Book it, see [Bread](Bread.md)\n");
});

test("discards an edit without writing it", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, change: CHECKLIST },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  const preview = page.getByLabel("Change to the shard");
  await expect(preview).toBeVisible();

  await assistant.getByRole("button", { name: "Discard" }).click();
  await expect(preview).toHaveCount(0);
  await expect(assistant.getByText("1 change")).toHaveCount(0);
  await expect(editor(page)).toContainText("Lisbon in May, by train.");
  expect(await shardSaves(page)).toEqual([]);
});

test("turning the assistant off leaves nothing behind", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, change: CHECKLIST },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  await panel(page).getByRole("button", { name: "Summarize this shard" }).click();
  const preview = page.getByLabel("Change to the shard");
  await expect(preview).toBeVisible();

  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await page.getByRole("button", { name: "AI assistant" }).click();
  await page.getByRole("switch", { name: "Turn on the assistant" }).click();
  await expect(page.getByRole("switch", { name: "Turn on the assistant" })).not.toBeChecked();
  await settings.click();

  // No preview, no panel, no button, and the shard as it was, unwritten.
  await expect(editor(page)).toContainText("Lisbon in May, by train.");
  await expect(preview).toHaveCount(0);
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Show assistant" })).toHaveCount(0);
  expect(await shardSaves(page)).toEqual([]);
  expect(
    await page.evaluate(() =>
      window.__commands.filter((c) => c.command === "assistant_apply").length,
    ),
  ).toBe(0);
});

test("adds an answer to the shard, without its cites", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();

  await assistant.getByRole("button", { name: "Add to shard" }).click();
  await expect(editor(page)).toContainText("We go to Lisbon in May.");
  await expect(editor(page)).not.toContainText("May Trip");
});
