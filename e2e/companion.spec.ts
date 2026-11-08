import type { Page } from "@playwright/test";

import { expect, mockVault, test } from "./vault";

/**
 * The companion as the assistant: his menu, his spot on the panel, and the
 * companion he is today while the assistant is off. Reduced motion puts him
 * straight into each pose, so nothing waits on an animation; the tests at
 * the end turn motion back on to watch him move through a real answer.
 */

const FILES = {
  "Trip.md": "# Trip\n\nLisbon in May, by train.\n",
  "Packing.md": "# Packing\n\nPassports.\n",
  "Tickets.md": "# Tickets\n\nThe night train.\n",
};
const READY = {
  provider: true,
  vaultAllowed: true,
  picked: true,
  answer: ["We go to Lisbon in May."],
};

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

const hit = (page: Page) => page.locator('.companion [data-part="hit"]');
const menu = (page: Page) => page.getByRole("menu", { name: "Kevin" });
const panel = (page: Page) => page.getByRole("complementary", { name: "Assistant" });
const SMILE = "M-2,-60Q2,-56 6,-60";

/** Where his feet are, in the window. */
async function feet(page: Page) {
  return page.locator(".companion").evaluate((host) => {
    const rect = host.getBoundingClientRect();
    return { x: Math.round(rect.left + 300 * 0.6), y: Math.round(rect.top + 150 * 0.6) };
  });
}

async function turnAssistantOff(page: Page) {
  const settings = page.getByRole("button", { name: "Settings", exact: true });
  await settings.click();
  await page.getByRole("button", { name: "AI assistant" }).click();
  await page.getByRole("switch", { name: "Turn on the assistant" }).click();
  await expect(page.getByRole("switch", { name: "Turn on the assistant" })).not.toBeChecked();
  await settings.click();
}

test("is poked as today while the assistant is off", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", companion: true });
  await hit(page).click();
  // The poke: his mouth opens, then smiles again. No menu.
  await expect(page.locator('.companion [data-part="mouth"]')).not.toHaveAttribute("d", SMILE);
  await expect(page.locator('.companion [data-part="mouth"]')).toHaveAttribute("d", SMILE);
  await expect(menu(page)).toHaveCount(0);
});

test("opens his menu above him, and sends from the panel he sits on", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await hit(page).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem")).toHaveText([
    "Ask about this shard",
    "Summarize this shard",
    "Find related shards",
    "Open chat",
    "Hide Kevin",
  ]);
  const box = (await menu(page).boundingBox())!;
  const at = await feet(page);
  expect(Math.round(box.width)).toBe(216);
  expect(Math.round(box.x + box.width)).toBe(at.x + 34);
  expect(box.y + box.height).toBeLessThanOrEqual(at.y - 66 + 1);

  await menu(page).getByRole("menuitem", { name: "Summarize this shard" }).click();
  await expect(panel(page).getByText("We go to Lisbon in May.")).toBeVisible();
  expect(await page.evaluate(() => window.__sent)).toEqual([
    { chat: null, text: "Summarize this shard", shards: ["Trip.md"] },
  ]);

  // He sits on the composer's top edge, 52 px in from its right edge, and
  // the messages leave room under him.
  const card = (await panel(page).locator(".border-input.bg-card").boundingBox())!;
  await expect.poll(() => feet(page)).toEqual({ x: Math.round(card.x + card.width - 52), y: Math.round(card.y + 1) });
  await expect(panel(page).locator(".overflow-y-auto").first()).toHaveCSS("padding-bottom", "96px");
});

test("asks about the shard in the composer", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await hit(page).click();
  await menu(page).getByRole("menuitem", { name: "Ask about this shard" }).click();
  await expect(panel(page).getByRole("textbox", { name: "Message" })).toBeFocused();
  expect(await page.evaluate(() => window.__sent)).toEqual([]);
});

test("sleeps while no provider is set up", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: {}, companion: true });
  await expect(page.locator(".companion")).toHaveAttribute("data-zz", "");
  await expect(page.locator(".companion .companion-z").first()).toHaveCSS("opacity", "1");
});

test("turning the assistant off sends him back to his corner and leaves nothing behind", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  const corner = await feet(page);
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect.poll(() => feet(page)).not.toEqual(corner);

  await turnAssistantOff(page);
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(() => feet(page)).toEqual(corner);
  await hit(page).click();
  await expect(page.locator('.companion [data-part="mouth"]')).not.toHaveAttribute("d", SMILE);
  await expect(page.locator('.companion [data-part="mouth"]')).toHaveAttribute("d", SMILE);
  await expect(menu(page)).toHaveCount(0);
});

test("hides from his menu", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await hit(page).click();
  await menu(page).getByRole("menuitem", { name: "Hide Kevin" }).click();
  await expect(page.locator(".companion")).toHaveCount(0);
  // The assistant works without him.
  await page.getByRole("button", { name: "Show assistant" }).click();
  await panel(page).getByRole("button", { name: "Summarize this shard" }).click();
  await expect(panel(page).getByText("We go to Lisbon in May.")).toBeVisible();
});

test("offers only what isn't on screen already", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await page.getByRole("button", { name: "Show assistant" }).click();
  await expect(panel(page)).toBeVisible();
  await hit(page).click();
  await expect(menu(page).getByRole("menuitem")).toHaveText([
    "Ask about this shard",
    "Summarize this shard",
    "Find related shards",
    /^Hide /,
  ]);
});

test("stays left of the browser panel, and moves with the panel when it's dragged", async ({ page }) => {
  await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
  await page.getByRole("button", { name: "Show browser panel" }).click();
  const handle = page.locator('[data-slot="resizable-handle"]');
  const left = async () => (await handle.boundingBox())!.x;
  const right = () => page.locator(".companion").evaluate((host) => host.getBoundingClientRect().right);
  await expect.poll(async () => (await right()) <= (await left())).toBe(true);

  // On the panel, he follows its composer as the browser panel is dragged
  // wider, which moves the panel without resizing it.
  await page.getByRole("button", { name: "Show assistant" }).click();
  const card = panel(page).locator(".border-input.bg-card");
  const perch = async () => {
    const box = (await card.boundingBox())!;
    return { x: Math.round(box.x + box.width - 52), y: Math.round(box.y + 1) };
  };
  const onPerch = async () => JSON.stringify(await feet(page)) === JSON.stringify(await perch());
  await expect.poll(onPerch).toBe(true);
  const before = await perch();
  const grip = (await handle.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x - 150, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await perch()).x).toBeLessThan(before.x - 100);
  await expect.poll(onPerch).toBe(true);

  // Closed, he's back in his corner, still left of the browser panel.
  await panel(page).getByRole("button", { name: "Hide assistant" }).click();
  await expect.poll(async () => (await right()) <= (await left())).toBe(true);
});

test.describe("with motion on", () => {
  const part = (page: Page, name: string) => page.locator(`.companion [data-part="${name}"]`);
  const mouth = (page: Page) => part(page, "mouth").getAttribute("d");
  const happy = (page: Page) => part(page, "happy").getAttribute("visibility");
  const muscled = (page: Page) =>
    part(page, "frontArmR").locator("[data-muscle]").getAttribute("visibility");
  const gem = (page: Page) => part(page, "gem").getAttribute("visibility");
  const O_MOUTH = "M-0.6,-59.5a2.6,3 0 1,0 5.2,0a2.6,3 0 1,0-5.2,0Z";
  const SLOW = { timeout: 20_000 };

  /** Notes, each frame, where his feet are and what he shows. */
  async function watch(page: Page) {
    await page.evaluate(() => {
      const log: { x: number; y: number; happy: boolean; lean: number; muscled: boolean }[] = [];
      (window as unknown as { __seen: typeof log }).__seen = log;
      const host = document.querySelector<HTMLElement>(".companion")!;
      const tick = () => {
        const rect = host.getBoundingClientRect();
        const tilt = host.querySelector('[data-part="frontBody"]')?.getAttribute("transform") ?? "";
        log.push({
          x: Math.round(rect.left + 300 * 0.6),
          y: Math.round(rect.top + 150 * 0.6),
          happy: host.querySelector('[data-part="happy"]')?.getAttribute("visibility") === "visible",
          lean: Number(tilt.match(/rotate\((-?[\d.]+)/)?.[1] ?? 0),
          muscled:
            host.querySelector('[data-part="frontArmR"] [data-muscle]')?.getAttribute("visibility") === "inherit",
        });
        requestAnimationFrame(tick);
      };
      tick();
    });
  }
  const seen = (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __seen: { x: number; y: number; happy: boolean; lean: number; muscled: boolean }[] })
          .__seen,
    );

  async function send(page: Page, text: string) {
    const box = panel(page).getByRole("textbox", { name: "Message" });
    await box.fill(text);
    await box.press("Enter");
  }

  test("hops onto the panel, reads and is done, with the window unfocused", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockVault(page, {
      files: FILES,
      open: "Trip.md",
      assistant: { ...READY, reads: ["Trip.md"], hold: true },
      companion: true,
    });
    // As with the app on a second screen: the window isn't focused.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const corner = await feet(page);
    await watch(page);
    await page.getByRole("button", { name: "Show assistant" }).click();
    const card = (await panel(page).locator(".border-input.bg-card").boundingBox())!;
    const perch = { x: Math.round(card.x + card.width - 52), y: Math.round(card.y + 1) };
    await expect.poll(() => feet(page), SLOW).toEqual(perch);
    // He flew there in an arc, above both ends, rather than jumping.
    const path = await seen(page);
    const between = path.filter((at) => at.x !== corner.x && at.x !== perch.x);
    expect(between.length).toBeGreaterThan(5);
    expect(Math.min(...between.map((at) => at.y))).toBeLessThan(Math.min(corner.y, perch.y) - 20);

    await send(page, "When do we go?");
    // Reading: mouth open, his shard held up.
    await expect.poll(() => mouth(page), SLOW).toBe(O_MOUTH);
    expect(await gem(page)).toBe("visible");
    await page.evaluate(() => window.__answer?.());
    await expect(panel(page).getByText("We go to Lisbon in May.")).toBeVisible();
    // Done: happy eyes, then back to his smile.
    await expect.poll(() => happy(page), SLOW).toBe("visible");
    await expect.poll(() => happy(page), SLOW).toBe("hidden");
    await expect.poll(() => mouth(page), SLOW).toBe(SMILE);
  });

  test("stays on the panel, only hidden, while Settings opens and closes", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockVault(page, { files: FILES, open: "Trip.md", assistant: READY, companion: true });
    await page.getByRole("button", { name: "Show assistant" }).click();
    const card = (await panel(page).locator(".border-input.bg-card").boundingBox())!;
    const perch = { x: Math.round(card.x + card.width - 52), y: Math.round(card.y + 1) };
    await expect.poll(() => feet(page), SLOW).toEqual(perch);
    await watch(page);

    const settings = page.getByRole("button", { name: "Settings", exact: true });
    await settings.click();
    await expect(page.locator(".companion")).toHaveCSS("opacity", "0");
    await settings.click();
    await expect(page.locator(".companion")).toHaveCSS("opacity", "1");
    // Two seconds of frames after closing, a hop home and back would show.
    const closed = (await seen(page)).length;
    await expect.poll(async () => (await seen(page)).length, SLOW).toBeGreaterThan(closed + 120);
    expect((await seen(page)).every((at) => at.x === perch.x && at.y === perch.y)).toBe(true);
  });

  const SEVERAL = {
    ...READY,
    hold: true,
    change: { path: "Trip.md", after: "# Trip\n\nLisbon in June.\n", also: ["Packing.md", "Tickets.md"] },
  };

  test("eats his shard, bulks up and flexes on a change to several shards, then spits it out", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockVault(page, { files: FILES, open: "Trip.md", assistant: SEVERAL, companion: true });
    await page.getByRole("button", { name: "Show assistant" }).click();
    await expect(panel(page)).toBeVisible();
    await send(page, "Move the trip to June");
    // Unfocused, as when the message was sent from the browser panel.
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await watch(page);
    await expect.poll(() => muscled(page), SLOW).toBe("inherit");
    expect(await gem(page)).toBe("hidden");
    await page.evaluate(() => window.__answer?.());
    await expect(panel(page).getByRole("button", { name: "Discard all" })).toBeVisible();

    // He finishes his flexes, shrinks back with his shard in his hands, and
    // is done.
    await expect.poll(() => happy(page), SLOW).toBe("visible");
    expect(await muscled(page)).toBe("hidden");
    expect(await gem(page)).toBe("visible");
    // One flex each, in turn: double biceps, then leaning left, then right,
    // each played out over frames rather than jumped to (three flexes take
    // over four seconds).
    const frames = await seen(page);
    expect(frames.filter((at) => at.muscled).length).toBeGreaterThan(4 * 60);
    const leans = frames.map((at) => at.lean);
    expect(Math.min(...leans)).toBeLessThan(-2.9);
    expect(Math.max(...leans)).toBeGreaterThan(2.9);
  });

  test("shrinks back without Done when the changes are discarded mid-flex", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await mockVault(page, { files: FILES, open: "Trip.md", assistant: SEVERAL, companion: true });
    await page.getByRole("button", { name: "Show assistant" }).click();
    await expect(panel(page)).toBeVisible();
    await send(page, "Move the trip to June");
    await expect.poll(() => muscled(page), SLOW).toBe("inherit");
    await page.evaluate(() => window.__answer?.());
    await watch(page);
    await panel(page).getByRole("button", { name: "Discard all" }).click();
    await expect.poll(() => muscled(page), SLOW).toBe("hidden");
    await expect.poll(() => gem(page), SLOW).toBe("visible");
    // Done would follow within a second of his shard landing back in his
    // hands; two seconds of frames on, it never came.
    const landed = (await seen(page)).length;
    await expect.poll(async () => (await seen(page)).length, SLOW).toBeGreaterThan(landed + 120);
    expect((await seen(page)).some((at) => at.happy)).toBe(false);
    await expect.poll(() => mouth(page), SLOW).toBe(SMILE);
  });
});
