import { expect, mockVault, test, VAULT_PATH } from "./vault";

const FILES = {
  "Note.md": "# Note\n\nStart\n",
  // The tag sits below the fold, so opening it has to scroll.
  "Plans.md": `# Plans\n\n${"Filler.\n\n".repeat(80)}Next up #ideas for the garden.\n`,
};

test("a shard opened from Tags scrolls to the tag and selects it", async ({
  page,
}) => {
  await page.addInitScript((vaultPath) => {
    type Bridge = { invoke: (command: string, args?: unknown) => unknown };
    let bridge: Bridge | undefined;
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      get: () => bridge,
      set: (value: Bridge) => {
        const invoke = value.invoke;
        value.invoke = async (command, args) => {
          if (command === "get_tagged_files") {
            return [
              {
                path: `${vaultPath}/Plans.md`,
                name: "Plans.md",
                last_modified: 0,
                tags: [{ tag: "ideas", excerpt: null }],
              },
            ];
          }
          return invoke(command, args);
        };
        bridge = value;
      },
    });
  }, VAULT_PATH);
  await mockVault(page, { files: FILES, open: "Note.md" });

  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await page.getByRole("button", { name: /^Plans/ }).click();
  await expect(page.getByRole("button", { name: "Editor" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await expect(page.getByText("Next up #ideas for the garden.")).toBeInViewport();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString()))
    .toBe("#ideas");
});
