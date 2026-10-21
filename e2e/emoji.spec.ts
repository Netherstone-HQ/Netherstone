import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import type { Page } from "@playwright/test";

import { editor, expect, mockVault, test } from "./vault";

type EmojiData = { emojis: Record<string, { skins: { native: string }[] }> };

const require = createRequire(import.meta.url);
const pickerEmoji = Object.values((require("@emoji-mart/data") as EmojiData).emojis).flatMap(
  (emoji) => emoji.skins.map((skin) => skin.native),
);

/**
 * The emoji in the shard that draw wider than one emoji: a sequence the font
 * can't join shows as its parts side by side.
 */
async function splitEmoji(page: Page): Promise<string[]> {
  return editor(page).evaluate(async (element) => {
    await document.fonts.ready;
    const size = parseFloat(getComputedStyle(element).fontSize);
    const split: string[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const segmenter = new Intl.Segmenter();
    while (walker.nextNode()) {
      const text = walker.currentNode as Text;
      for (const { segment, index } of segmenter.segment(text.data)) {
        if (!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)) continue;
        const range = document.createRange();
        range.setStart(text, index);
        range.setEnd(text, index + segment.length);
        if (range.getBoundingClientRect().width > size * 1.6) split.push(segment);
      }
    }
    return split;
  });
}

test("every emoji the picker offers shows as one emoji", async ({ page }) => {
  await mockVault(page, { files: { "Emoji.md": `${pickerEmoji.join(" ")}\n` }, open: "Emoji.md" });
  await expect(editor(page)).toContainText(pickerEmoji.at(-1)!);
  expect(await splitEmoji(page)).toEqual([]);
});

test("newer emoji and flags stay whole when the system emoji font lacks them", async ({ page }) => {
  // Stands in for an older system emoji font, like Windows': it has each part
  // but can't join them, and draws flags as two letters.
  const oldFont = [...readFileSync(new URL("./fixtures/emoji-without-sequences.woff2", import.meta.url))];
  await page.addInitScript((bytes) => {
    for (const family of ["Apple Color Emoji", "Segoe UI Emoji"]) {
      document.fonts.add(new FontFace(family, new Uint8Array(bytes)));
    }
  }, oldFont);

  await mockVault(page, { files: { "Emoji.md": "😶‍🌫️ 🧔‍♂️ 🇹🇳\n" }, open: "Emoji.md" });
  await expect(editor(page)).toContainText("🇹🇳");
  expect(await splitEmoji(page)).toEqual([]);
});
