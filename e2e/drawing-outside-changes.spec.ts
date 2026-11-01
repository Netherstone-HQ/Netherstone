import type { Page } from "@playwright/test";
import { changeOutside, expect, mockVault, savesFor, test } from "./vault";

/**
 * A drawing changed by another app or by sync while it's open shows the
 * change, and autosave never writes over it.
 */

const shape = (id: string, x: number) => ({
  id,
  type: "rectangle",
  x,
  y: 200,
  width: 120,
  height: 80,
  angle: 0,
  strokeColor: "#1e1e1e",
  backgroundColor: "transparent",
  fillStyle: "solid",
  strokeWidth: 2,
  strokeStyle: "solid",
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
});

const drawing = (...shapes: ReturnType<typeof shape>[]) =>
  JSON.stringify(
    {
      type: "excalidraw",
      version: 2,
      source: "e2e",
      elements: shapes,
      appState: { viewBackgroundColor: "#ffffff" },
      files: {},
    },
    null,
    2,
  );

/** Moves every shape on the canvas one step right, as a user would. */
async function moveEverything(page: Page) {
  await page.locator("canvas.interactive").click({ position: { x: 900, y: 700 } });
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ArrowRight");
}

test("an outside change shows in the open drawing without a save", async ({ page }) => {
  await page.clock.install();
  await mockVault(page, {
    files: { "Plan.excalidraw": drawing(shape("a", 100)) },
    drawing: "Plan.excalidraw",
  });
  await expect(page.locator("canvas.interactive")).toBeVisible();

  await changeOutside(page, "Plan.excalidraw", drawing(shape("a", 100), shape("b", 400)));
  await page.clock.runFor(2500);
  expect(await savesFor(page, "Plan.excalidraw")).toEqual([]);

  // Selecting everything picks up the new shape, and the save keeps it.
  await moveEverything(page);
  await expect.poll(async () => (await savesFor(page, "Plan.excalidraw")).length).toBe(1);
  const [save] = await savesFor(page, "Plan.excalidraw");
  const saved = JSON.parse(save.content) as { elements: { id: string; x: number }[] };
  expect(saved.elements.map(({ id, x }) => [id, x])).toEqual([
    ["a", 101],
    ["b", 401],
  ]);
});

test("a save never writes over a change it hasn't shown", async ({ page }) => {
  await mockVault(page, {
    files: { "Plan.excalidraw": drawing(shape("a", 100)) },
    drawing: "Plan.excalidraw",
  });
  await expect(page.locator("canvas.interactive")).toBeVisible();

  // Changed without the watcher noticing; this mock can't merge it.
  const outside = drawing(shape("b", 400));
  await page.evaluate((outside) => {
    window.__vaultFiles["Plan.excalidraw"] = outside;
  }, outside);
  await moveEverything(page);

  await expect(page.getByText("Couldn't save drawing")).toBeVisible();
  expect(await savesFor(page, "Plan.excalidraw")).toEqual([]);
  expect(await page.evaluate(() => window.__vaultFiles["Plan.excalidraw"])).toBe(outside);
});
