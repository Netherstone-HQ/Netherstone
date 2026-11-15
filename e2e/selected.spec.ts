import type { Page } from "@playwright/test";
import {
  caretAfter,
  changeOutside,
  editor,
  expect,
  lastSave,
  mockVault,
  pickOption,
  test,
} from "./vault";

/**
 * What each kind of element shows while the selection touches it (a ring,
 * an outline, its toolbar), step by step. The expected lists are what the
 * editor showed before selected state was worked out once per change, so
 * any difference is a change someone can see.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const KINDS = `---
title: Kinds
---

# Kinds

Intro [Other](Other.md) and $x^2$ inline.

Before image

![Pic](_attachments/pic.png)

| A | B |
| - | - |
| one | two |

\`\`\`js
const a = 1;
\`\`\`

\`\`\`mermaid
flowchart LR
  Draft --> Review
\`\`\`

$$
y = mx
$$

---

<!-- netherstone columns: 50%, 50% -->
Left side
<!-- netherstone column -->
Right side
<!-- netherstone /columns -->

| Week | km |
| ---- | -- |
| 1 | 5 |

<!-- netherstone chart: bar; x Week; y km -->

<div class="old">
Old HTML
</div>

Outro.
`;

const FILES = { "Kinds.md": KINDS, "Other.md": "# Other\n\nThe other one.\n" };
const ASSETS = { "_attachments/pic.png": PNG };

/**
 * Every element showing it's selected, as `kind` or `kind:name`, then the
 * toolbars open over the shard.
 */
async function shown(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-slate-editor]")!;
    const out: string[] = [];
    const hasClass = (element: Element, name: string) =>
      [element, ...element.querySelectorAll("*")].some((node) => node.classList.contains(name));
    for (const element of root.querySelectorAll("[data-slate-node='element']")) {
      const kind = [...element.classList].find((name) => name.startsWith("slate-"))?.slice("slate-".length);
      switch (kind) {
        case "mention":
          if (hasClass(element, "ring-2")) out.push(`mention:${element.getAttribute("data-slate-value")}`);
          break;
        case "inline_equation":
          if (hasClass(element, "after:bg-brand/15")) out.push(kind);
          break;
        case "equation":
          if (element.querySelector("[data-selected='true']")) out.push(kind);
          break;
        case "img":
          if (hasClass(element, "outline-ring")) out.push(kind);
          break;
        case "hr":
        case "front_matter":
          if (hasClass(element, "ring-2")) out.push(kind);
          break;
        case "raw_block": {
          const name = element.querySelector("[data-chart]") ? "chart" : "verbatim";
          if (hasClass(element, "ring-2")) out.push(name);
          break;
        }
        case "table":
          // Resize handles show on the selected table (and on hover, which
          // the steps keep the pointer away from).
          if (element.querySelector(".group\\/resize")) {
            out.push(`table:${element.querySelector("[data-table-cell-id]")?.textContent?.trim()}`);
          }
          break;
        case "code_block": {
          const view = element.querySelector("[role='radio'][aria-checked='true'], [role='radio'][data-state='on']");
          if (view) out.push(`diagram:${view.getAttribute("aria-label") ?? view.textContent?.trim()}`);
          break;
        }
      }
    }
    for (const popover of document.querySelectorAll("[data-radix-popper-content-wrapper]")) {
      if (popover.querySelector("[aria-label='Merge cells'], [aria-label='Add a chart of this table']")) {
        out.push("toolbar:table");
      } else if (popover.textContent?.includes("Edit link")) {
        out.push("toolbar:image");
      } else if (popover.querySelectorAll("button").length > 0 && !popover.textContent?.trim()) {
        out.push("toolbar:column");
      } else {
        out.push(`toolbar:${popover.textContent?.trim().slice(0, 20)}`);
      }
    }
    return out;
  });
}

/** Moves the pointer off the shard, so nothing shows only because of hover. */
async function pointerAway(page: Page) {
  await page.mouse.move(1, 1);
}

/** Waits for the elements showing selected to be `expected`. */
async function expectShown(page: Page, expected: string[]) {
  await pointerAway(page);
  await expect.poll(() => shown(page)).toEqual(expected);
}

/** What differs between the page's selection and the editor's, if anything. */
function selectionSettled(page: Page) {
  return page.evaluate(() => {
    const root = document.querySelector("[data-slate-editor]")!;
    const fiberKey = Object.keys(root).find((key) => key.startsWith("__reactFiber$"))!;
    type Editor = {
      selection: unknown;
      api: { toSlateRange: (range: Selection, options: object) => unknown };
    };
    type Fiber = { memoizedProps?: { editor?: Editor }; return: Fiber };
    let fiber = (root as unknown as Record<string, Fiber>)[fiberKey];
    while (!fiber.memoizedProps?.editor) fiber = fiber.return;
    const editor = fiber.memoizedProps.editor;
    const page = editor.api.toSlateRange(getSelection()!, { exactMatch: false, suppressThrow: true });
    // A caret on an element without text (an @ link) has no page range.
    if (!page || JSON.stringify(page) === JSON.stringify(editor.selection)) return "";
    return `the page has ${JSON.stringify(page)}, the editor ${JSON.stringify(editor.selection)}`;
  });
}

/**
 * Presses `key` once the editor has the selection the last key left. Keys
 * the browser handles (Shift+arrows) move the page's selection first, and
 * the editor takes it a moment later.
 */
async function press(page: Page, key: string) {
  await expect.poll(() => selectionSettled(page)).toBe("");
  await page.keyboard.press(key);
}

/** Presses `key` once per entry of `expected`, checking what shows after each press. */
async function walk(page: Page, key: string, expected: string[][]) {
  for (const after of expected) {
    await press(page, key);
    await expectShown(page, after);
  }
}

/** Runs `change` on the editor itself, as a change from code would. */
async function changeEditor(page: Page, change: string) {
  await page.evaluate((change) => {
    const root = document.querySelector("[data-slate-editor]")!;
    const fiberKey = Object.keys(root).find((key) => key.startsWith("__reactFiber$"))!;
    type Fiber = { memoizedProps?: { editor?: unknown }; return: Fiber };
    let fiber = (root as unknown as Record<string, Fiber>)[fiberKey];
    while (!fiber.memoizedProps?.editor) fiber = fiber.return;
    new Function("editor", change)(fiber.memoizedProps.editor);
  }, change);
}

/** Places the caret at the start of the block holding `text`. */
async function caretAtStart(page: Page, text: string) {
  await caretAfter(page, text);
  await press(page, "Home");
}

const elementOf = (page: Page, kind: string) =>
  editor(page).locator(`[data-slate-node='element'].slate-${kind}`);

test.describe("selected state per kind of element", () => {
  test.beforeEach(async ({ page }) => {
    await mockVault(page, { files: FILES, assets: ASSETS, open: "Kinds.md" });
    await expect(editor(page)).toContainText("Outro.");
  });

  test("arrowing down through the shard and back up", async ({ page }) => {
    await caretAfter(page, "Kinds");
    await press(page, "ControlOrMeta+Home");
    await expectShown(page, ["diagram:Diagram"]);
    await walk(page, "ArrowDown", [
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["img", "diagram:Diagram", "toolbar:image"],
      ["diagram:Diagram", "toolbar:image"],
      ["table:A", "diagram:Diagram", "toolbar:table"],
      ["table:A", "diagram:Diagram", "toolbar:table"],
      ["diagram:Diagram"],
      ["diagram:Diagram", "equation"],
      ["diagram:Diagram", "hr"],
      ["diagram:Diagram", "toolbar:column"],
      ["diagram:Diagram", "toolbar:column"],
      ["diagram:Diagram", "table:Week", "toolbar:table"],
      ["diagram:Diagram", "table:Week", "toolbar:table"],
      ["diagram:Diagram", "chart"],
      ["diagram:Diagram", "verbatim"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
    ]);
    await walk(page, "ArrowUp", [
      ["diagram:Diagram"],
      ["diagram:Diagram", "verbatim"],
      ["diagram:Diagram", "chart"],
      ["diagram:Diagram", "table:Week", "toolbar:table"],
      ["diagram:Diagram", "table:Week", "toolbar:table"],
      ["diagram:Diagram", "toolbar:column"],
      ["diagram:Diagram", "toolbar:column"],
      ["diagram:Diagram", "hr"],
      ["diagram:Diagram", "equation"],
      ["diagram:Diagram"],
      ["table:A", "diagram:Diagram", "toolbar:table"],
      ["table:A", "diagram:Diagram", "toolbar:table"],
      ["img", "diagram:Diagram", "toolbar:image"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["front_matter", "diagram:Diagram"],
      ["front_matter", "diagram:Diagram"],
      ["front_matter", "diagram:Diagram"],
      ["front_matter", "diagram:Diagram"],
      ["front_matter", "diagram:Diagram"],
      ["front_matter", "diagram:Diagram"],
    ]);
  });

  test("arrowing across an @ link and an inline equation", async ({ page }) => {
    await caretAtStart(page, "Intro");
    await expectShown(page, ["diagram:Diagram"]);
    await walk(page, "ArrowRight", [
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["mention:Other", "diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["inline_equation", "diagram:Diagram", "toolbar:x^2Done"],
      ["inline_equation", "diagram:Diagram", "toolbar:x^2Done"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
    ]);
    await walk(page, "ArrowLeft", [
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["inline_equation", "diagram:Diagram", "toolbar:x^2Done"],
      ["inline_equation", "diagram:Diagram", "toolbar:x^2Done"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["mention:Other", "diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
      ["diagram:Diagram"],
    ]);
  });

  test("clicking into each element, then on text", async ({ page }) => {
    const clicks: [() => Promise<void>, string[]][] = [
      [() => elementOf(page, "img").locator("img").click(), ["img", "diagram:Diagram", "toolbar:image"]],
      [() => editor(page).getByText("two", { exact: true }).click(), ["table:A", "diagram:Diagram", "toolbar:table"]],
      [() => editor(page).getByText("const a = 1;").click(), ["diagram:Diagram"]],
      [() => elementOf(page, "equation").click(), ["diagram:Diagram", "equation", "toolbar:y = mxDone"]],
      [() => elementOf(page, "hr").click(), ["diagram:Diagram", "hr"]],
      [() => editor(page).getByText("Right side").click(), ["diagram:Diagram", "toolbar:column"]],
      [() => editor(page).locator("[data-chart]").click(), ["diagram:Diagram", "chart"]],
      [() => editor(page).getByText("Old HTML").click(), ["diagram:Diagram", "verbatim"]],
      [() => elementOf(page, "front_matter").click(), ["front_matter", "diagram:Diagram"]],
      [() => elementOf(page, "inline_equation").click(), ["inline_equation", "diagram:Diagram", "toolbar:x^2Done"]],
      [() => editor(page).getByText("Outro.").click(), ["diagram:Diagram"]],
    ];
    for (const [click, expected] of clicks) {
      await click();
      await expectShown(page, expected);
    }
  });

  test("selecting across several elements", async ({ page }) => {
    await caretAtStart(page, "Before image");
    await walk(page, "Shift+ArrowDown", [
      ["diagram:Diagram"],
      ["img", "table:A", "diagram:Diagram"],
      ["img", "table:A", "diagram:Diagram"],
      ["img", "table:A", "diagram:Both", "equation"],
      ["img", "table:A", "diagram:Both", "equation", "hr"],
      ["img", "table:A", "diagram:Both", "equation", "hr"],
      ["img", "table:A", "diagram:Both", "equation", "hr"],
      ["img", "table:A", "diagram:Both", "equation", "hr", "table:Week"],
      ["img", "table:A", "diagram:Both", "equation", "hr", "table:Week", "chart"],
      ["img", "table:A", "diagram:Both", "equation", "hr", "table:Week", "chart", "verbatim"],
      ["img", "table:A", "diagram:Both", "equation", "hr", "table:Week", "chart", "verbatim"],
      ["img", "table:A", "diagram:Both", "equation", "hr", "table:Week", "chart", "verbatim"],
    ]);
    await editor(page).getByText("Intro").click({ position: { x: 0, y: 5 } });
    await expectShown(page, ["diagram:Both"]);
    await editor(page).getByText("Right side").click({ modifiers: ["Shift"] });
    await expectShown(page, ["mention:Other", "inline_equation", "img", "table:A", "diagram:Both", "equation", "hr"]);
    // Select all puts the caret on the last line and selects every block.
    // The inline equation's edit box no longer opens here: it opened when
    // its old "selected" met the new collapsed caret in one render.
    await press(page, "ControlOrMeta+a");
    await expectShown(page, ["diagram:Both"]);
    await press(page, "ControlOrMeta+a");
    await expectShown(page, ["diagram:Both"]);
    await editor(page).getByText("Outro.").click();
    await expectShown(page, ["diagram:Both"]);
  });

  test("clicking outside the editor and back", async ({ page }) => {
    await editor(page).getByText("two", { exact: true }).click();
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await page.mouse.click(720, 10);
    await expect(editor(page)).not.toBeFocused();
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await editor(page).getByText("two", { exact: true }).click();
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await elementOf(page, "hr").click();
    await expectShown(page, ["diagram:Diagram", "hr"]);
    await page.mouse.click(720, 10);
    await expectShown(page, ["diagram:Diagram"]);
    await elementOf(page, "hr").click();
    await expectShown(page, ["diagram:Diagram", "hr"]);
  });
});

test.describe("when paths change under the selection", () => {
  test.beforeEach(async ({ page }) => {
    await mockVault(page, { files: FILES, assets: ASSETS, open: "Kinds.md" });
    await expect(editor(page)).toContainText("Outro.");
  });

  test("a block dragged above the selected table, undone and redone", async ({ page }) => {
    await editor(page).getByText("two", { exact: true }).click();
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    const block = editor(page).locator("[data-slate-node='element']", { hasText: "Outro." }).last();
    await block.hover();
    const handle = page.locator("[data-plate-prevent-deselect]").filter({ visible: true }).first();
    const target = (await editor(page).getByText("Before image").boundingBox())!;
    await handle.hover();
    await page.mouse.down();
    await page.mouse.move(target.x + 10, target.y + target.height / 4, { steps: 10 });
    await page.mouse.up();
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await press(page, "ControlOrMeta+z");
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await press(page, "ControlOrMeta+Shift+z");
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
  });

  test("the block above the selected table removed by another app", async ({ page }) => {
    await editor(page).getByText("two", { exact: true }).click();
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await changeOutside(page, "Kinds.md", KINDS.replace("Before image\n\n", ""));
    await expect(editor(page)).not.toContainText("Before image");
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
  });

  test("a block inserted above with Enter, undone and redone", async ({ page }) => {
    await caretAtStart(page, "Before image");
    await press(page, "Enter");
    await expectShown(page, ["diagram:Diagram"]);
    await press(page, "ArrowDown");
    await expectShown(page, ["img", "diagram:Diagram", "toolbar:image"]);
    await press(page, "ControlOrMeta+z");
    await expectShown(page, ["diagram:Diagram"]);
    await press(page, "ControlOrMeta+Shift+z");
    await expectShown(page, ["img", "diagram:Diagram", "toolbar:image"]);
  });

  test("blocks inserted, moved and removed above the selected image in one change", async ({ page }) => {
    await elementOf(page, "img").locator("img").click();
    await expectShown(page, ["img", "diagram:Diagram", "toolbar:image"]);
    await changeEditor(page, `
      editor.tf.withoutNormalizing(() => {
        const image = editor.children.findIndex((node) => node.type === "img");
        const outro = editor.children.findIndex((node) => node.children?.[0]?.text === "Outro.");
        editor.tf.moveNodes({ at: [outro], to: [image] });
        editor.tf.insertNodes({ type: "p", children: [{ text: "Inserted" }] }, { at: [1] });
        editor.tf.removeNodes({ at: [image] });
      });
    `);
    await expect(editor(page)).toContainText("Inserted");
    await expectShown(page, ["img", "diagram:Diagram", "toolbar:image"]);
    await press(page, "ControlOrMeta+z");
    await expectShown(page, ["img", "diagram:Diagram", "toolbar:image"]);
    await press(page, "ControlOrMeta+Shift+z");
    await expectShown(page, ["img", "diagram:Diagram", "toolbar:image"]);
  });

  test("the selected table moved to the top in one change, undone and redone", async ({ page }) => {
    await editor(page).getByText("two", { exact: true }).click();
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await changeEditor(page, `
      const table = editor.children.findIndex((node) => node.type === "table");
      editor.tf.moveNodes({ at: [table], to: [1] });
    `);
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await press(page, "ControlOrMeta+z");
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
    await press(page, "ControlOrMeta+Shift+z");
    await expectShown(page, ["table:A", "diagram:Diagram", "toolbar:table"]);
  });
});

test.describe("menus that put an element at the caret", () => {
  const MENU_FILES = { "Note.md": "# Note\n\nStart\n", "Other Note.md": "# Other Note\n" };

  test.beforeEach(async ({ page }) => {
    await mockVault(page, { files: MENU_FILES, open: "Note.md" });
    await caretAfter(page, "Start");
  });

  test("an @ link picked, then typed after at once", async ({ page }) => {
    await page.keyboard.type(" see @Oth");
    await pickOption(page, page.getByRole("option", { name: "Other Note" }));
    await page.keyboard.type(" now");
    await expectShown(page, []);
    const saved = await lastSave(page, "Note.md");
    expect(saved).toContain("Start see [Other Note](Other%20Note.md) now");
    await press(page, "Shift+Home");
    await expectShown(page, ["mention:Other Note"]);
    await press(page, "End");
    await expectShown(page, []);
  });

  test("an equation from the / menu, then typed after", async ({ page }) => {
    await press(page, "Enter");
    await page.keyboard.type("/equation");
    await pickOption(page, page.getByRole("option", { name: "Equation", exact: true }));
    await expectShown(page, ["equation"]);
    await press(page, "ArrowDown");
    await expectShown(page, []);
    await page.keyboard.type("after");
    await expect(editor(page)).toContainText("after");
    await expectShown(page, []);
    await walk(page, "ArrowUp", [
      ["equation"],
      [],
    ]);
  });
});

test.describe("work per key", () => {
  /** A long shard: @ links in text, lists and tables, with pictures, equations and dividers between. */
  function longShard(sections: number) {
    let markdown = "# Long\n\n";
    for (let i = 0; i < sections; i += 1) {
      markdown += `Section ${i} links [Other](Other.md) and [Other](Other.md) in text ${i}.\n\n`;
      markdown += `- an item with [Other](Other.md)\n\n`;
      markdown += `| Name | Link |\n| - | - |\n| row ${i} | [Other](Other.md) |\n\n`;
      markdown += `![Pic](_attachments/pic.png)\n\n$$\nx_${i}\n$$\n\n---\n\n`;
    }
    return markdown;
  }
  const LONG_SECTIONS = 100;

  /** Counts the editor's range lookups while one letter is typed after `text`. */
  async function rangesPerKey(page: Page, text: string) {
    await caretAfter(page, text);
    await changeEditor(page, `
      const range = editor.range;
      window.__ranges = 0;
      editor.range = (...args) => {
        window.__ranges += 1;
        return range(...args);
      };
    `);
    await page.keyboard.type("Q");
    await expect(editor(page).getByText(`${text}Q`)).toBeVisible();
    return page.evaluate(() => (window as unknown as { __ranges: number }).__ranges);
  }

  test("typing doesn't check every element for selection", async ({ page }) => {
    await mockVault(page, {
      files: { ...FILES, "Long.md": longShard(LONG_SECTIONS) },
      assets: ASSETS,
      open: "Kinds.md",
    });
    await expect(editor(page)).toContainText("Outro.");
    const short = await rangesPerKey(page, "Outro.");
    await page.getByText("Long", { exact: true }).first().click();
    // The last section shows once the whole shard is drawn.
    await expect(editor(page)).toContainText(`in text ${LONG_SECTIONS - 1}.`);
    const long = await rangesPerKey(page, `in text ${LONG_SECTIONS / 2}.`);
    // A key typed in text flips no element's selected state, so the work
    // per key can't grow with the number of elements: the long shard runs
    // no more range lookups than the short one. Checking each element
    // runs one per element, hundreds here.
    expect(long).toBeLessThanOrEqual(short);
  });
});
