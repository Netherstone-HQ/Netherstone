import { expect, mockVault, test } from "./vault";

/**
 * An answer streaming in only grows: no line goes away, the view stuck to
 * the bottom never scrolls up, and no text moves, then or once it's saved.
 */

const FILES = { "Trip.md": "# Trip\n\n## Plans\n\nLisbon in May, by train.\n" };

/** Before the tool, then after it. */
const FIRST = `We go to Lisbon in May by the night train [Trip](Trip.md#Plans), with one change in Hendaye [Trip](Trip.md#Plans). The sleeper has **two-berth cabins** and a \`dining car\`, and [Trip](Trip.md) has the times.

Costs
---

| Item | Who | Cost |
| --- | --- | --- |
| Train | Both | 340 |
| Room | Both | 610 |

- Night train tickets, booked as soon as sales open [Trip](Trip.md#Plans).
- A room near Alfama for five nights, *close to the tram*.

Let me check the plan for the return.`;

const SECOND = `The return isn't booked yet [Trip](Trip.md#Plans), and ~~prices~~ fares go up after March.

1. Book the return by February.
2. Check the sleeper's dates weekly.

\`\`\`
Paris 19:40 -> Hendaye 06:10
Hendaye 07:05 -> Lisbon 16:20
\`\`\`

Back home, keep the receipts for the shared spreadsheet [Trip](Trip.md#Plans).`;

/** Text that must stay where it first shows, from the start of each step. */
const MARKERS = ["We go to Lisbon", "The return isn't"];

/** As small as a provider's batches can be. */
const PIECE_LENGTH = 5;
/** Frames to wait after the answer is saved, to catch a late move. */
const SETTLE_FRAMES = 10;

function pieces(text: string) {
  const found: string[] = [];
  for (let start = 0; start < text.length; start += PIECE_LENGTH) {
    found.push(text.slice(start, start + PIECE_LENGTH));
  }
  return found;
}

/** Window widths and the panel width each leaves. */
const WIDTHS = [
  { window: 900, panel: 320 },
  { window: 1000, panel: 384 },
  { window: 1280, panel: 400 },
];

declare global {
  interface Window {
    /** What moved while the answer streamed in, and frames seen. */
    __moves: string[];
    __frames: number;
  }
}

for (const { window: width, panel: panelWidth } of WIDTHS) {
  test(`streams in without moving back at a ${panelWidth} px panel`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    const first = pieces(FIRST);
    const answer = [...first, ...pieces(SECOND)];
    await mockVault(page, {
      files: FILES,
      open: "Trip.md",
      assistant: {
        provider: true,
        vaultAllowed: true,
        picked: true,
        answer,
        toolAfter: first.length,
        reasoning: "The plan is in Trip.",
        stepped: true,
      },
    });
    await page.getByRole("button", { name: "Show assistant" }).click();
    const panel = page.getByRole("complementary", { name: "Assistant" });
    await expect.poll(() => panel.evaluate((el) => el.getBoundingClientRect().width)).toBe(panelWidth);

    // Each frame and change: the chat's height, its scroll, and where each
    // marker sits in it.
    await panel.evaluate((root, markers) => {
      window.__moves = [];
      window.__frames = 0;
      let height = 0;
      let top = 0;
      const seen = new Map<string, number>();
      const at = (content: Element, marker: string) => {
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent?.startsWith(marker)) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().top - content.getBoundingClientRect().top;
        }
        return null;
      };
      const sample = () => {
        const scroller = root.querySelector(".overflow-y-auto");
        const content = scroller?.firstElementChild;
        if (!scroller || !content) return;
        const now = content.getBoundingClientRect().height;
        if (now < height) window.__moves.push(`shrank from ${height} to ${now}`);
        if (scroller.scrollTop < top) {
          window.__moves.push(`scrolled up from ${top} to ${scroller.scrollTop}`);
        }
        height = now;
        top = scroller.scrollTop;
        for (const marker of markers) {
          const y = at(content, marker);
          if (y === null) continue;
          const was = seen.get(marker);
          if (was === undefined) seen.set(marker, y);
          else if (y !== was) window.__moves.push(`"${marker}" moved from ${was} to ${y}`);
        }
      };
      new MutationObserver(sample).observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
      });
      const frame = () => {
        sample();
        window.__frames += 1;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    }, MARKERS);

    await panel.getByRole("textbox", { name: "Message" }).fill("plan the trip");
    await page.keyboard.press("Enter");
    for (let index = 0; index < answer.length; index += 1) {
      await page.waitForFunction(() => window.__piece);
      await page.evaluate(() => {
        const next = window.__piece!;
        window.__piece = undefined;
        next();
      });
    }

    // Saved: the answer has its Copy row.
    await expect(panel.getByRole("button", { name: "Copy" })).toHaveCount(1);
    const frames = await page.evaluate(() => window.__frames);
    await expect.poll(() => page.evaluate(() => window.__frames)).toBeGreaterThan(frames + SETTLE_FRAMES);
    expect(await page.evaluate(() => window.__moves)).toEqual([]);
    // The view kept up with the answer.
    const scroller = panel.locator(".overflow-y-auto").first();
    expect(
      await scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
    ).toBeLessThanOrEqual(1);
  });
}

test("shows thinking before a tool with the text after it, as one", async ({ page }) => {
  await mockVault(page, {
    files: FILES,
    open: "Trip.md",
    assistant: {
      provider: true,
      vaultAllowed: true,
      picked: true,
      answer: ["We go ", "in May."],
      toolAfter: 0,
      reasoning: "Read the trip first.\n\n",
      stepped: true,
    },
  });
  await page.getByRole("button", { name: "Show assistant" }).click();
  const panel = page.getByRole("complementary", { name: "Assistant" });
  await panel.getByRole("textbox", { name: "Message" }).fill("When do we go?");
  await page.keyboard.press("Enter");
  const thinking = panel.getByRole("button", { name: "Thinking", exact: true });
  // While the tool runs, then as the text comes, then saved.
  await expect(thinking).toHaveCount(1);
  await thinking.click();
  for (const shown of ["We go", "We go in May."]) {
    await page.waitForFunction(() => window.__piece);
    await page.evaluate(() => {
      const next = window.__piece!;
      window.__piece = undefined;
      next();
    });
    await expect(panel.getByText(shown, { exact: true })).toBeVisible();
    await expect(thinking).toHaveCount(1);
  }
  await expect(panel.getByRole("button", { name: "Copy" })).toHaveCount(1);
  await expect(thinking).toHaveCount(1);
  // Still open, with no blank lines after the thinking.
  await expect(thinking).toHaveAttribute("aria-expanded", "true");
  await expect(panel.getByText("Read the trip first.")).toHaveJSProperty(
    "textContent",
    "Read the trip first.",
  );
});
