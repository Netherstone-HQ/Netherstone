import type { Page } from "@playwright/test";
import { expect, mockVault, test, VAULT_PATH } from "./vault";

const FILES = { "Note.md": "# Note\n\nStart\n" };

/** Reports a sync conflict on `path`. Registered before `mockVault`. */
async function mockConflict(page: Page, path: string) {
  await page.addInitScript(
    ({ vaultPath, path }) => {
      type Bridge = { invoke: (command: string, args?: unknown) => unknown };
      let bridge: Bridge | undefined;
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        get: () => bridge,
        set: (value: Bridge) => {
          const invoke = value.invoke;
          value.invoke = async (command, args) => {
            if (command === "sync_get_vault_record") {
              return {
                vaultId: "abc",
                vaultPath,
                syncEnabled: true,
                remoteUrl: null,
                repoName: null,
                branch: "main",
                lastCommit: null,
                lastCommitAt: null,
                lastSyncAt: null,
                conflicts: [{ path, theirs: "blob", detectedAt: 0 }],
              };
            }
            return invoke(command, args);
          };
          bridge = value;
        },
      });
    },
    { vaultPath: VAULT_PATH, path },
  );
}

const files = (page: Page) => page.getByRole("region", { name: "Files" });

test("a folder stays open when the window gets narrow, and Collapse all closes it", async ({
  page,
}) => {
  await mockVault(page, { files: FILES, folders: ["Work"], open: "Note.md" });
  await page.goto("/");

  const folder = files(page).getByRole("button", { name: "Work", exact: true });
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect(files(page).getByRole("button", { name: "Collapse all" })).toHaveCount(0);
  await folder.click();
  await expect(folder).toHaveAttribute("aria-expanded", "true");

  // Minimizing on Windows shrinks the window to nothing for a moment.
  await page.setViewportSize({ width: 500, height: 900 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(folder).toBeVisible();
  await expect(folder).toHaveAttribute("aria-expanded", "true");

  await files(page).getByRole("button", { name: "Collapse all" }).click();
  await expect(folder).toHaveAttribute("aria-expanded", "false");
  await expect(files(page).getByRole("button", { name: "Collapse all" })).toHaveCount(0);
});

test("the rail stays on top while the sidebar slides away", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Note.md" });
  await page.goto("/");

  const editor = page.getByRole("button", { name: "Editor", exact: true });
  await expect(editor).toBeVisible();
  const box = (await editor.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.getByRole("button", { name: "Hide left sidebar" }).click();
  // Mid-slide, the sidebar passes under the rail, never over it.
  for (let i = 0; i < 5; i++) {
    const onTop = await page.evaluate(
      ({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[aria-label="Editor"]'),
      center,
    );
    expect(onTop).toBe(true);
    await page.waitForTimeout(40);
  }
});

test("a file with a sync conflict is marked by its name and asks for the choice on opening", async ({ page }) => {
  await mockConflict(page, "Note.md");
  await mockVault(page, { files: FILES, open: "Note.md" });
  await page.goto("/");

  const row = files(page).getByRole("button", { name: "Note Changed on two devices" });
  await expect(row.getByRole("img", { name: "Changed on two devices" })).toBeVisible();
  await row.click();
  await expect(page.getByRole("dialog", { name: "Choose which version to keep" })).toBeVisible();
});
