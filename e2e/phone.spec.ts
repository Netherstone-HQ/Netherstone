import { devices } from "@playwright/test";
import { expect, mockVault, test } from "./vault";

test.use({ ...devices["Pixel 7"], browserName: "chromium" });

const FILES = {
  "Start here.md": "# Start here\n\nWhat this vault is for.\n",
  "Architecture/Overview.md": "# Overview\n\nHow Netherstone is put together.\n",
  "Architecture/Backend/Git sync.md": "# Git sync\n\nThis keeps the vault in a private repository.\n",
  "Journal/2026-11-19.md": "# 2026-11-19\n\nA quiet day.\n",
};

test("home shows search, recent, folders and top-level shards", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await expect(page.locator("#splash")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-home.png" });
});

test("a folder opens a shard on its own screen, and Back steps out again", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Architecture/ }).click();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await page.getByRole("button", { name: /^Overview/ }).click();
  await expect(page.locator("[data-slate-editor]")).toContainText("How Netherstone is put together.");
  await page.screenshot({ path: "test-results/phone-shard.png" });

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("button", { name: "Search this vault" })).toBeVisible();
});

test("+ makes an Untitled shard, next to one already called that, and opens it", async ({ page }) => {
  await mockVault(page, { files: { ...FILES, "Untitled.md": "Shopping list\n" }, nested: true });
  await page.getByRole("button", { name: "New shard", exact: true }).click();

  await expect(page.locator("[data-slate-editor]")).toBeVisible();
  const opened = await page.evaluate(() =>
    window.__commands
      .filter((c) => c.command === "open_markdown_file")
      .map((c) => (c.args as { filePath: string }).filePath),
  );
  expect(opened).toContainEqual(expect.stringMatching(/\/Untitled 2\.md$/));
  expect(opened).not.toContainEqual(expect.stringMatching(/\/Untitled\.md$/));
});

test("pressing and holding a row opens its menu, and Pin pins it", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Start here/ }).click({ button: "right" });
  const menu = page.getByRole("dialog", { name: "Start here" });
  await expect(menu.getByRole("button", { name: "Move to trash" })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: "test-results/phone-row-menu.png" });
  await menu.getByRole("button", { name: "Pin" }).click();

  await expect(menu).toBeHidden();
  const pinned = page.getByRole("region", { name: "Pinned" });
  await expect(pinned.getByRole("button", { name: /^Start here/ })).toBeVisible();
});

test("swiping a row left shows Pin and Delete, and Delete asks first", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  const row = page.getByRole("button", { name: /^Start here/ });
  const box = (await row.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 20, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 40, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.getByRole("button", { name: "Pin", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-row-swipe.png" });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  const ask = page.getByRole("alertdialog", { name: "Move “Start here” to trash?" });
  await ask.getByRole("button", { name: "Move to trash" }).click();

  await expect(ask).toBeHidden();
  const deleted = await page.evaluate(() =>
    window.__commands
      .filter((c) => c.command === "delete_vault_path")
      .map((c) => (c.args as { targetPath: string }).targetPath),
  );
  expect(deleted).toEqual(["/home/me/Vault/Start here.md"]);
});

test("select mode picks shards, pins them together, and Back leaves it", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Architecture/ }).click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Select" }).click();

  await expect(page.getByRole("heading", { name: "0 selected" })).toBeVisible();
  // Only shards are picked, so the folder inside isn't shown.
  await expect(page.getByRole("button", { name: /^Backend/ })).toHaveCount(0);
  await page.getByRole("checkbox", { name: /^Overview/ }).click();
  await expect(page.getByRole("heading", { name: "1 selected" })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-select.png" });

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();

  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Select" }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByRole("heading", { name: "1 selected" })).toBeVisible();
  await page.getByRole("button", { name: "Pin", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Architecture" })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const pinned = page.getByRole("region", { name: "Pinned" });
  await expect(pinned.getByRole("button", { name: /^Overview/ })).toBeVisible();
});

const V = "/home/me/Vault";

test("search finds shards with the words lit, and Back from a result keeps the search", async ({ page }) => {
  await page.addInitScript((vault) => {
    window.__overrides = {
      search_files: (args) =>
        (args as { query: string }).query === "sync"
          ? [
              {
                path: `${vault}/Architecture/Backend/Git sync.md`,
                name: "Git sync.md",
                title: [{ text: "Git ", highlight: false }, { text: "sync", highlight: true }],
                snippet: [
                  { text: "This keeps the vault in a private repository. ", highlight: false },
                  { text: "Sync", highlight: true },
                  { text: " runs on start.", highlight: false },
                ],
                section: null,
                rank: 1,
              },
            ]
          : [],
      get_tagged_files: () => [
        { path: `${vault}/Journal/2026-11-19.md`, name: "2026-11-19.md", last_modified: 1, tags: [{ tag: "journal", excerpt: null }] },
        { path: `${vault}/Architecture/Overview.md`, name: "Overview.md", last_modified: 1, tags: [{ tag: "architecture", excerpt: null }] },
      ],
    };
  }, V);
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: "Search this vault" }).click();

  const field = page.getByRole("searchbox", { name: "Search this vault" });
  await expect(field).toBeFocused();
  await expect(page.getByRole("region", { name: "Show only" })).toBeVisible();
  await expect(page.getByRole("button", { name: "journal" })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-search-start.png" });

  await field.fill("sycn");
  await expect(page.getByText("No shards match “sycn”")).toBeVisible();
  await page.screenshot({ path: "test-results/phone-search-none.png" });

  await field.fill("sync");
  await expect(page.getByText("1 shard", { exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-search.png" });
  await page.getByRole("button", { name: /^Git sync/ }).click();
  await expect(page.locator("[data-slate-editor]")).toContainText("private repository");

  await page.goBack();
  await expect(page.getByRole("searchbox")).toHaveValue("sync");
  await page.getByRole("button", { name: "Clear search" }).click();
  await expect(page.getByRole("region", { name: "Recent searches" }).getByRole("button", { name: "sync" })).toBeVisible();
});

test("All tags lists the vault's tags, and a tag shows its shards", async ({ page }) => {
  await page.addInitScript((vault) => {
    window.__overrides = {
      get_tagged_files: () => [
        { path: `${vault}/Journal/2026-11-19.md`, name: "2026-11-19.md", last_modified: 1, tags: [{ tag: "journal", excerpt: null }] },
        { path: `${vault}/Architecture/Overview.md`, name: "Overview.md", last_modified: 1, tags: [{ tag: "architecture", excerpt: null }] },
      ],
    };
  }, V);
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: "Search this vault" }).click();
  await page.getByRole("button", { name: "All tags" }).click();

  await expect(page.getByRole("heading", { name: "Tags" })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-tags.png" });
  await page.getByRole("button", { name: /^journal/ }).click();
  await expect(page.getByRole("button", { name: /^2026-11-19/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Overview/ })).toHaveCount(0);
});

test("Settings lists the phone's categories, and each one opens", async ({ page }) => {
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Vault/ }).first().click();
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await page.screenshot({ path: "test-results/phone-settings.png" });

  const names = await page.getByRole("navigation", { name: "Settings" }).getByRole("button").allInnerTexts();
  expect(names.map((name) => name.split("\n")[0])).toEqual([
    "General", "Appearance", "Editor", "Microphone", "Vault", "Files & attachments", "Sync", "AI assistant", "About",
  ]);
  for (const name of ["General", "Appearance", "Editor", "Microphone", "Vault", "Files & attachments", "Sync", "AI assistant", "About"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
    await expect(page.getByRole("heading", { name, exact: true }).first()).toBeVisible();
    await page.screenshot({ path: `test-results/phone-settings-${name.split(" ")[0].toLowerCase()}.png`, fullPage: true });
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  }
  // Wide content must not make the page scroll sideways.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

const now = Math.floor(Date.now() / 1000);

test("history lists versions, a version opens on its own screen, and Restore puts it back", async ({ page }) => {
  await mockVault(page, {
    files: { "Bread.md": "# Bread\n\nUse 350 g water.\n" },
    versions: {
      "Bread.md": [
        { time: now - 3600, content: "# Bread\n\nUse 375 g water.\n\nRest an hour.\n", added: 3, removed: 1 },
        { time: now - 7200, content: "# Bread\n", kind: "created" },
      ],
    },
  });
  await page.getByRole("button", { name: /^Bread/ }).click();
  await expect(page.locator("[data-slate-editor]")).toContainText("350 g");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Show history" }).click();

  const sheet = page.getByRole("dialog", { name: "History" });
  await expect(sheet.getByText("Current")).toBeVisible();
  await page.screenshot({ path: "test-results/phone-history.png" });
  await sheet.getByRole("button", { name: /Added 3 words, removed 1/ }).click();

  await expect(page.getByRole("button", { name: "Restore this version" })).toBeVisible();
  await expect(page.getByText("Show changes")).toBeVisible();
  await page.screenshot({ path: "test-results/phone-version.png" });

  // Back returns to the list, and picking again shows the version again.
  await page.goBack();
  await expect(sheet.getByText("Current")).toBeVisible();
  await sheet.getByRole("button", { name: /Added 3 words, removed 1/ }).click();
  await page.getByRole("button", { name: "Restore this version" }).click();

  await expect(page.getByText(/^Restored/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore this version" })).toHaveCount(0);
  await expect(page.locator("[data-slate-editor]")).toContainText("375 g");
  await page.screenshot({ path: "test-results/phone-restored.png" });
});

test("the assistant opens in a sheet, and its change shows in the shard with Apply", async ({ page }) => {
  await mockVault(page, {
    files: { "Trip.md": "# Trip\n\nLisbon in May, by train.\n" },
    assistant: {
      provider: true,
      vaultAllowed: true,
      picked: true,
      answer: ["Here's the change."],
      change: { path: "Trip.md", after: "# Trip\n\nLisbon in May, by train.\n\nBook the sleeper.\n" },
    },
  });
  await page.getByRole("button", { name: /^Trip/ }).click();
  await page.getByRole("button", { name: "Assistant", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Assistant" });
  const box = sheet.getByRole("textbox", { name: "Message" });
  await box.fill("Add a line about booking");
  await box.press("Enter");
  await expect(sheet.getByText("Here's the change.")).toBeVisible();
  await page.screenshot({ path: "test-results/phone-assistant.png" });

  await sheet.getByRole("button", { name: "Trip", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("1 change")).toBeVisible();
  await page.screenshot({ path: "test-results/phone-assistant-change.png" });
  await page.getByRole("button", { name: "Apply" }).click();

  await expect(sheet).toBeVisible();
  await page.getByRole("button", { name: "Hide assistant" }).click();
  await expect(page.locator("[data-slate-editor]")).toContainText("Book the sleeper.");
});

test("the welcome tour fits a phone: no window buttons, a vault made by name", async ({ page }) => {
  await mockVault(page, { files: {}, noVault: true });
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem("netherstone-settings") ?? "{}");
    settings.state.onboardingCompletedAt = null;
    localStorage.setItem("netherstone-settings", JSON.stringify(settings));
    window.__overrides = {
      default_vault_location: () => "/home/me/Vaults",
      create_vault: (args) => `${(args as { parent: string }).parent}/${(args as { name: string }).name}`,
    };
  });
  await page.reload();

  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByRole("heading", { name: "Where should your knowledge live?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /minimize|maximize|close/i })).toHaveCount(0);
  await page.screenshot({ path: "test-results/phone-onboarding-vault.png" });

  await page.getByRole("button", { name: /^Create a new vault/ }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("My Vault");
  await page.screenshot({ path: "test-results/phone-onboarding-name.png" });
  await page.getByRole("button", { name: "Create vault" }).click();

  const created = await page.evaluate(() =>
    window.__commands.filter((c) => c.command === "create_vault").map((c) => c.args),
  );
  expect(created).toEqual([{ parent: "/home/me/Vaults", name: "My Vault" }]);
  await expect(page.getByRole("heading", { name: "Where should your knowledge live?" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/phone-onboarding-next.png" });
});

test("the Trash restores an item, and Select deletes several forever", async ({ page }) => {
  await page.addInitScript((vault) => {
    const today = Date.now();
    window.__appTrash = [
      { id: "1/2026-11-18.md", name: "2026-11-18.md", from: `${vault}/Journal/2026-11-18.md`, isFolder: false, deletedAt: today, bytes: 2048, historyOf: null },
      { id: "2/Ideas", name: "Ideas", from: `${vault}/Ideas`, isFolder: true, deletedAt: today, bytes: 1024, historyOf: null },
      { id: "3/abc", name: "abc", from: "/data/sync/abc", isFolder: true, deletedAt: today, bytes: 4096, historyOf: "Old notes" },
    ];
  }, V);
  await mockVault(page, { files: FILES, nested: true });
  await page.getByRole("button", { name: /^Vault/ }).first().click();
  await expect(page.getByRole("button", { name: /^Trash/ })).toContainText("3");
  await page.getByRole("button", { name: /^Trash/ }).click();
  await expect(page.getByText("3 items")).toBeVisible();
  const trash = page.getByRole("region", { name: "Deleted items" });
  await expect(trash.getByRole("button", { name: /^2026-11-18/ })).toContainText("Journal");
  await expect(trash.getByRole("button", { name: /^History of Old notes/ })).toContainText("A vault that's gone");
  await page.screenshot({ path: "test-results/phone-trash.png" });

  await trash.getByRole("button", { name: /^2026-11-18/ }).click();
  await page.getByRole("button", { name: "Restore" }).click();
  await expect(trash.getByRole("button")).toHaveCount(2);

  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.getByRole("button", { name: "Select all" }).click();
  await expect(page.getByRole("heading", { name: "2 selected" })).toBeVisible();
  await page.getByRole("button", { name: "Delete forever" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Delete 2 items forever?");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Trash is empty")).toBeVisible();
  expect(await page.evaluate(() => window.__appTrash)).toEqual([]);
});