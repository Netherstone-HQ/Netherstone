import type { Locator, Page, Route } from "@playwright/test";

/**
 * Runs the built app in a plain browser against an in-memory vault.
 *
 * The Tauri bridge (`window.__TAURI_INTERNALS__`) is replaced before the app
 * loads, so backend commands answer from the given files and every save is
 * recorded in `window.__saves`. Nothing touches a real file system.
 */

export const VAULT_PATH = "/home/me/Vault";

export type VaultFiles = Record<string, string>;

export type Save = { filePath: string; content: string };

declare global {
  interface Window {
    __saves: Save[];
    __vaultFiles: VaultFiles;
  }
}

export type MockVaultOptions = {
  files: VaultFiles;
  /** The shard open when the app starts, relative to the vault. */
  open: string;
  theme?: "light" | "dark";
};

export async function mockVault(page: Page, options: MockVaultOptions) {
  const { files, open, theme = "dark" } = options;

  await page.addInitScript(
    ({ vaultPath, files, theme, open }) => {
      const now = Date.now();
      const seconds = Math.floor(now / 1000);
      const relative = (filePath: string) =>
        filePath.replace(`${vaultPath}/`, "");

      window.__saves = [];
      window.__vaultFiles = files;

      localStorage.setItem(
        "netherstone-vault",
        JSON.stringify({
          state: { currentVaultPath: vaultPath, recentVaults: [vaultPath] },
          version: 0,
        }),
      );
      localStorage.setItem(
        "netherstone-settings",
        JSON.stringify({
          state: {
            onboardingCompletedAt: now - 86_400_000,
            theme,
            showCompanion: false,
          },
          version: 2,
        }),
      );
      localStorage.setItem(
        "netherstone-ui",
        JSON.stringify({
          state: {
            isSidebarOpen: true,
            isSidebarOpenOutsideCanvas: true,
            isRightSidebarOpen: false,
            activeNavItem: "notes",
            recentFiles: [
              {
                path: `${vaultPath}/${open}`,
                name: open.replace(/\.md$/, ""),
              },
            ],
            pinnedFiles: [],
          },
          version: 0,
        }),
      );

      const tree = Object.keys(files).map((name) => ({
        name,
        path: `${vaultPath}/${name}`,
        kind: "file",
      }));

      type Args = Record<string, string>;
      const handlers: Record<string, (args: Args) => unknown> = {
        scan_vault: () => tree,
        index_vault: () => "ok",
        open_markdown_file: ({ filePath }) => ({
          file_path: filePath,
          markdown: files[relative(filePath)] ?? "",
          content_hash: `hash-${relative(filePath)}`,
          cache_hit: false,
          plate_value: null,
        }),
        read_markdown_file: ({ filePath }) => files[relative(filePath)] ?? "",
        save_markdown_file: ({ filePath, content }) => {
          files[relative(filePath)] = content;
          window.__saves.push({ filePath, content });
          return null;
        },
        file_exists: ({ path, filePath }) =>
          relative(path ?? filePath ?? "") in files,
        get_file_metadata: ({ filePath }) => {
          const content = files[relative(filePath)] ?? "";
          return {
            created_at: seconds,
            last_modified: seconds,
            word_count: 1,
            character_count: content.length,
            file_size: content.length,
            tags: [],
          };
        },
        get_backlinks: () => [],
        get_backlinks_count: () => 0,
        get_tagged_files: () => [],
        search_files: () => [],
        find_shards_containing: () => [],
        sync_get_vault_record: () => null,
        github_get_account: () => null,
      };

      let callbackId = 0;
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { windowLabel: "main", label: "main" },
        },
        transformCallback: () => ++callbackId,
        unregisterCallback: () => {},
        convertFileSrc: (path: string) => path,
        invoke: async (command: string, args: Args = {}) => {
          if (handlers[command]) return handlers[command](args);
          if (command.startsWith("plugin:event|listen")) return ++callbackId;
          if (command === "plugin:app|version") return "0.0.0-e2e";
          return null;
        },
      };
      (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ =
        { unregisterListener: () => {} };
    },
    { vaultPath: VAULT_PATH, files, theme, open },
  );

  // The desktop app sends no network requests; a browser does (favicons,
  // fonts the bundle already carries). Let nothing leave the page.
  await page.route(/^(?!http:\/\/(localhost|127\.0\.0\.1))/, (route: Route) =>
    route.abort(),
  );

  await page.goto("/");
  await page.locator("[data-slate-editor]").first().waitFor();
}

export const editor = (page: Page) => page.locator("[data-slate-editor]").first();

/** Opens a shard from the sidebar by its name (without `.md`). */
export async function openShard(page: Page, name: string) {
  await page.getByText(name, { exact: true }).first().click();
  await editor(page).waitFor();
}

/** Places the caret at the end of the block holding `text`. */
export async function caretAfter(page: Page, text: string) {
  const block = editor(page)
    .locator("[data-slate-node='element']")
    .filter({ hasText: text })
    .last();
  await block.click();
  // A click lands mid-text; move the caret to the block's end through the
  // DOM selection, which the editor follows.
  await block.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let last: Text | null = null;
    while (walker.nextNode()) last = walker.currentNode as Text;
    if (!last) return;
    const range = document.createRange();
    range.setStart(last, last.length);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.waitForTimeout(100);
}

/** The cells of a table's first row (the row handle column is not a cell). */
export const cellsOf = (row: Locator) =>
  row.locator("> [data-slate-node='element']");

/** Waits for autosave and returns the content it wrote for the shard. */
export async function lastSave(page: Page, name: string): Promise<string> {
  const filePath = `${VAULT_PATH}/${name}`;
  // Autosave is debounced, so a save can still be pending after the first
  // one lands. The top bar shows "Saved" only once nothing is left to write.
  await page.waitForFunction(
    (filePath) =>
      window.__saves.some((save) => save.filePath === filePath) &&
      document.querySelector('[aria-label="Saved"]') !== null,
    filePath,
    { timeout: 10_000 },
  );
  return page.evaluate(
    (filePath) =>
      window.__saves.filter((save) => save.filePath === filePath).at(-1)!
        .content,
    filePath,
  );
}

export async function savesFor(page: Page, name: string): Promise<Save[]> {
  const filePath = `${VAULT_PATH}/${name}`;
  return page.evaluate(
    (filePath) => window.__saves.filter((save) => save.filePath === filePath),
    filePath,
  );
}

/** Pastes through the real clipboard, so the app's paste handlers run. */
export async function paste(
  page: Page,
  data: { html?: string; text?: string },
) {
  await page.evaluate(async ({ html, text }) => {
    const items: Record<string, Blob> = {};
    if (html) items["text/html"] = new Blob([html], { type: "text/html" });
    if (text) items["text/plain"] = new Blob([text], { type: "text/plain" });
    await navigator.clipboard.write([new ClipboardItem(items)]);
  }, data);
  await page.keyboard.press("Control+V");
}

export type TableMeasure = {
  editorWidth: number;
  tableWidth: number;
  height: number;
  columns: number[];
};

export async function measureTables(page: Page): Promise<TableMeasure[]> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-slate-editor]")!;
    // The text column: the editor's width without the gutters around it.
    const rootStyle = getComputedStyle(root);
    const editorWidth = Math.round(
      root.getBoundingClientRect().width -
        parseFloat(rootStyle.paddingLeft) -
        parseFloat(rootStyle.paddingRight),
    );
    return [...root.querySelectorAll("table")].map((table) => ({
      editorWidth,
      tableWidth: Math.round(table.getBoundingClientRect().width),
      height: Math.round(table.getBoundingClientRect().height),
      columns: [
        ...(table.querySelector("tr")?.querySelectorAll(
          ":scope > [data-slate-node='element']",
        ) ?? []),
      ].map((cell) => Math.round(cell.getBoundingClientRect().width)),
    }));
  });
}
