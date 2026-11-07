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

test("shows a web image a change adds as its address, loading nothing", async ({ page }) => {
  const kept = "https://pictures.example/kept.png";
  const added = "https://pictures.example/new.png?d=Lisbon";
  const asked: string[] = [];
  await page.route("https://pictures.example/**", (route) => {
    asked.push(route.request().url());
    return route.abort();
  });
  await mockVault(page, {
    files: { ...FILES, "Trip.md": `# Trip\n\n![kept](${kept})\n\nLisbon in May.\n` },
    open: "Trip.md",
    assistant: {
      ...READY,
      change: {
        path: "Trip.md",
        after: `# Trip\n\n![kept](${kept})\n\nLisbon in May.\n\n![new](${added})\n`,
      },
    },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  await panel(page).getByRole("button", { name: "Summarize this shard" }).click();

  // The image already in the shard shows as it does there; the new one
  // only as its address.
  const preview = page.getByLabel("Change to the shard");
  await expect(preview).toContainText(`Image: ${added}`);
  await expect(preview).not.toContainText(`Image: ${kept}`);
  await expect(preview.locator(`img[src="${added}"]`)).toHaveCount(0);
  expect(asked).not.toContain(added);
});

test("shows the address of a web image in an answer", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, answer: ["See the map ![map](https://pictures.example/m.png)."] },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(assistant.getByText("See the map map (https://pictures.example/m.png).")).toBeVisible();
  await expect(assistant.locator("img")).toHaveCount(0);
});

test("shows a new shard in its card before it's made", async ({ page }) => {
  const image = "https://pictures.example/n.png";
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: {
      ...READY,
      change: {
        kind: "newShard",
        path: "Plans/Lisbon.md",
        after: `# Lisbon\n\nTrains at 9.\n\n![map](${image})\n`,
      },
    },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();

  await expect(assistant.getByText("New shard Lisbon")).toBeVisible();
  await expect(page.getByLabel("Change to the shard")).toHaveCount(0);
  const preview = assistant.getByLabel("Preview of New shard Lisbon");
  await expect(preview).toContainText("Trains at 9.");
  await expect(preview).toContainText(`Image: ${image}`);
  expect(await page.evaluate(() => window.__saves)).toEqual([]);

  // Once made, its name opens it.
  await assistant.getByRole("button", { name: "Apply" }).click();
  await assistant.getByRole("button", { name: "Lisbon", exact: true }).click();
  await expect(editor(page)).toContainText("Trains at 9.");
});

test("shows a drawing in its card before it's made", async ({ page }) => {
  const scene = JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [
      { id: "r", type: "rectangle", x: 0, y: 0, width: 120, height: 80, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false },
    ],
    appState: {},
    files: {},
  });
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, change: { kind: "newDrawing", path: "Sketch.excalidraw", after: scene } },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();

  await expect(assistant.getByText("New drawing Sketch")).toBeVisible();
  await expect(assistant.getByRole("img", { name: "Preview of New drawing Sketch" })).toBeVisible();
});

test("says where a move goes", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: {
      ...READY,
      change: { kind: "move", path: "Trip.md", after: "", moving: { folder: "Archive", name: null } },
    },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(assistant.getByText("Move Trip.md to Archive")).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Move Trip.md to Archive" })).toHaveCount(0);
});

test("opens a shard a change is to from its name, to show it there", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, change: { path: "Bread.md", after: "# Bread\n\nUse 360 g water.\n" } },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(page.getByLabel("Change to the shard")).toHaveCount(0);

  await assistant.getByRole("button", { name: "Bread", exact: true }).click();
  const preview = page.getByLabel("Change to the shard");
  await expect(preview).toContainText("Use 360 g water.");
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
  // It stays in the chat as discarded.
  await expect(assistant.getByText("Discarded Trip")).toBeVisible();
  await expect(editor(page)).toContainText("Lisbon in May, by train.");
  expect(await shardSaves(page)).toEqual([]);
});

test("applies or discards every change of an answer at once", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, change: { ...CHECKLIST, also: ["Bread.md"] } },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  const message = assistant.getByRole("textbox", { name: "Message" });
  await message.fill("Make both checklists");
  await page.keyboard.press("Enter");
  await expect(assistant.getByText("1 change")).toHaveCount(2);

  await assistant.getByRole("button", { name: "Apply all" }).click();
  await expect(assistant.getByText("Applied to")).toHaveCount(2);
  await expect(assistant.getByRole("button", { name: "Apply all" })).toHaveCount(0);
  const saved = await page.evaluate(() =>
    window.__saves.map((save) => save.filePath.split("/").pop()),
  );
  expect(saved).toEqual(expect.arrayContaining(["Trip.md", "Bread.md"]));

  await message.fill("Again");
  await page.keyboard.press("Enter");
  await expect(assistant.getByText("1 change")).toHaveCount(2);
  await assistant.getByRole("button", { name: "Discard all" }).click();
  await expect(assistant.getByText(/^Discarded /)).toHaveCount(2);
  await expect(assistant.getByText("1 change")).toHaveCount(0);
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

const LONG = {
  ...FILES,
  "Trip.md": `# Trip\n\n${Array.from({ length: 80 }, (_, i) => `Line ${i + 1}.`).join("\n\n")}\n\n## Plans\n\nLisbon in May, by train.\n`,
};

const searchDialog = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Search" });

test("has no Assistant group in search while the assistant is off", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Bread.md" });
  await expect(editor(page)).toContainText("350 g");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("when do we go");
  const search = searchDialog(page);
  await expect(search.getByText("No shards match “when do we go”")).toBeVisible();
  await expect(search.getByText("Ask about this")).toHaveCount(0);
  await expect(search.getByText("Tab", { exact: true })).toHaveCount(0);
});

test("asks from search, and carries on in the panel", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Bread.md", assistant: READY });
  await expect(editor(page)).toContainText("350 g");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("when do we go");
  const search = searchDialog(page);
  await expect(search.getByText("Ask about this")).toBeVisible();
  await page.keyboard.press("Tab");

  await expect(search.getByText("We go to Lisbon in May")).toBeVisible();
  expect(await page.evaluate(() => window.__sent)).toEqual([
    { chat: null, text: "when do we go", shards: [] },
  ]);
  await search.getByRole("button", { name: "Continue in chat" }).click();
  await expect(search).toHaveCount(0);
  await expect(panel(page).getByText("We go to Lisbon in May")).toBeVisible();
  // The same chat, saved and titled like any other.
  await expect(panel(page).getByRole("button", { name: "Chats" })).toHaveText("when do we go");
});

test("opens a cite from search at its section", async ({ page }) => {
  await mockVault(page, { files: LONG, open: "Bread.md", assistant: READY });
  await expect(editor(page)).toContainText("350 g");
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("when do we go");
  await page.keyboard.press("Tab");
  const search = searchDialog(page);
  await search.getByRole("button", { name: "Open Trip.md" }).click();
  await expect(search).toHaveCount(0);
  await expect(editor(page).getByRole("heading", { name: "Plans" })).toBeInViewport();
});

test("reads shards named in a sentence by name, and numbers only cites", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: {
      ...READY,
      answer: ["Linked from [1](Trip.md): [Bread](Bread.md) uses 350 g of water [Bread](Bread.md)."],
    },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();

  await expect(assistant.getByText(/^Linked from Trip: Bread uses 350 g of water/)).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Trip", exact: true })).toBeVisible();
  await expect(assistant.getByRole("button", { name: "Open Bread.md" })).toHaveText("1");
  // Only the cite is listed; nothing else the answer read.
  await expect(assistant.getByRole("button", { name: /^1\s*Bread$/ })).toBeVisible();
  await expect(assistant.getByRole("button", { name: /^\d\s*Trip/ })).toHaveCount(0);

  await assistant.getByRole("button", { name: "Bread", exact: true }).click();
  await expect(editor(page)).toContainText("350 g");
});

test("sizes the panel from its edge, and keeps the width", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await expect(assistant).toBeVisible();
  const box = (await assistant.boundingBox())!;
  expect(Math.round(box.width)).toBe(400);

  await page.mouse.move(box.x + 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x - 50, box.y + 300, { steps: 4 });
  await page.mouse.move(box.x + 2 - 100, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await assistant.boundingBox())!.width)).toBe(500);

  // Not past its widest.
  const wide = (await assistant.boundingBox())!;
  await page.mouse.move(wide.x + 2, wide.y + 300);
  await page.mouse.down();
  await page.mouse.move(wide.x - 600, wide.y + 300, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await assistant.boundingBox())!.width)).toBe(640);

  // Kept with the app's other panel sizes, and used when it opens again.
  const kept = await page.evaluate(() => localStorage.getItem("netherstone-ui"));
  expect(JSON.parse(kept!).state.assistantWidth).toBe(640);
  await page.getByRole("button", { name: "Hide assistant" }).first().click();
  await expect(panel(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect.poll(async () => Math.round((await panel(page).boundingBox())!.width)).toBe(640);
});

test("says what came before an error, and tries again from there", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: { ...READY, change: { path: "Bread.md", after: "# Bread\n\nUse 360 g water.\n" }, failOnce: "rateLimited" },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();

  await expect(assistant.getByRole("alert")).toHaveText(
    "The provider is getting too many requests, try again soon",
  );
  await expect(assistant.getByText("The changes above came before it stopped.")).toBeVisible();
  await expect(assistant.getByText("1 change")).toBeVisible();

  await assistant.getByRole("button", { name: "Try again" }).click();
  await expect(assistant.getByText("We go to Lisbon in May")).toBeVisible();
  await expect(assistant.getByRole("alert")).toHaveCount(0);
  // The same message goes on: nothing new is sent as the user's.
  expect(await page.evaluate(() => window.__sent.map((sent) => sent.text))).toEqual([
    "Summarize this shard",
    "",
  ]);
  await expect(assistant.getByText("1 change")).toBeVisible();
});

test("shows a drawing a change embeds once it's applied", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { isTauri: boolean }).isTauri = true;
  });
  const scene = JSON.stringify({
    type: "excalidraw",
    version: 2,
    elements: [
      { id: "r", type: "rectangle", x: 0, y: 0, width: 120, height: 80, angle: 0, strokeColor: "#1e1e1e", backgroundColor: "transparent", fillStyle: "solid", strokeWidth: 2, strokeStyle: "solid", roughness: 1, opacity: 100, groupIds: [], frameId: null, roundness: null, seed: 1, version: 1, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false },
    ],
    appState: {},
    files: {},
  });
  await mockVault(page, {
    files: { ...FILES, "Diagrams/Map.excalidraw": scene },
    open: "Trip.md",
    assistant: {
      ...READY,
      change: {
        path: "Trip.md",
        after: '# Trip\n\n## Plans\n\nLisbon in May, by train.\n\n<img src="" data-dark-src="" alt="Map" width="480" data-excalidraw="Diagrams/Map.excalidraw" />\n',
      },
    },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await assistant.getByRole("button", { name: "Apply" }).click();
  await expect(assistant.getByText("Applied to Trip")).toBeVisible();

  // Its pictures are made and shown, without opening the shard again.
  await expect
    .poll(() => page.evaluate(() => window.__vaultFiles["Trip.md"]))
    .toContain('src="_attachments/Map.png"');
  await expect(editor(page).getByText("No source found")).toHaveCount(0);
});

test("leaves the panel's chat as it was when search's answer isn't carried on", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const assistant = panel(page);
  await assistant.getByRole("button", { name: "Summarize this shard" }).click();
  await expect(assistant.getByRole("button", { name: "Chats" })).toHaveText("Summarize this shard");

  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type("when do we go");
  const search = searchDialog(page);
  await expect(search.getByText("Ask about this")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(search.getByText("We go to Lisbon in May")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(assistant.getByRole("button", { name: "Chats" })).toHaveText("Summarize this shard");
  await expect(assistant.getByText("Summarize this shard", { exact: true }).last()).toBeVisible();
});
