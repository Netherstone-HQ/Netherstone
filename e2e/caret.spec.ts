import type { Page } from "@playwright/test";
import {
  caretAfter,
  changeOutside,
  editor,
  expect,
  menuClosed,
  mockVault,
  openShard,
  paste,
  pickOption,
  test,
  VAULT_PATH,
} from "./vault";

/**
 * Where the caret is, and where the next key lands, after every kind of
 * edit. Each check shows the shard's text blocks one per line, as
 * `tag: text`, with `|` at the caret (and `^` at the other end of a
 * selection), so a caret one character off fails.
 */

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * The shard's text blocks one per line, `type: text`, with `|` at the
 * editor's caret and `^` at the other end of a selection. The caret the
 * page shows must be the same one: if it isn't, both are shown. In a
 * focused text box, its value with the caret marked.
 */
async function caretView(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
      const { value } = active;
      const start = active.selectionStart ?? 0;
      const end = active.selectionEnd ?? start;
      return start === end
        ? `${value.slice(0, start)}|${value.slice(start)}`
        : `${value.slice(0, start)}|${value.slice(start, end)}^${value.slice(end)}`;
    }
    const root = document.querySelector("[data-slate-editor]")!;

    const mark = (text: string, marks: [number, string][]) => {
      let shown = text;
      for (const [at, sign] of marks.sort((a, b) => b[0] - a[0])) {
        shown = shown.slice(0, at) + sign + shown.slice(at);
      }
      return shown.replaceAll("\n", "↵");
    };

    // The editor's own value and selection, from the React props of the
    // element it renders into.
    type Point = { path: number[]; offset: number };
    type Node = { text?: string; type?: string; children?: Node[]; [key: string]: unknown };
    type Editor = { children: Node[]; selection: { anchor: Point; focus: Point } | null; isInline: (node: Node) => boolean };
    const fiberKey = Object.keys(root).find((key) => key.startsWith("__reactFiber$"))!;
    let fiber = (root as unknown as Record<string, { memoizedProps?: { editor?: Editor }; return: unknown }>)[fiberKey];
    while (!fiber.memoizedProps?.editor) fiber = fiber.return as typeof fiber;
    const editor = fiber.memoizedProps.editor;
    const { selection } = editor;
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((n, i) => n === b[i]);
    const model: string[] = [];
    const leafBlock = (node: Node) =>
      node.children?.every((child) => child.text !== undefined || editor.isInline(child));
    const textOf = (node: Node, path: number[]): string => {
      if (node.text !== undefined) {
        const marks: [number, string][] = [];
        if (selection && same(selection.anchor.path, path)) marks.push([selection.anchor.offset, "|"]);
        if (selection && same(selection.focus.path, path) && (
          !same(selection.anchor.path, selection.focus.path) || selection.anchor.offset !== selection.focus.offset
        )) marks.push([selection.focus.offset, "^"]);
        let text = node.text;
        for (const [at, sign] of marks.sort((a, b) => b[0] - a[0])) text = text.slice(0, at) + sign + text.slice(at);
        return text;
      }
      return node.children!.map((child, i) => textOf(child, [...path, i])).join("");
    };
    // Each block named by its type and the types it sits in.
    const walk = (nodes: Node[], path: number[], within: string[]) => {
      for (const [i, node] of nodes.entries()) {
        if (node.text !== undefined) continue;
        const kind = [node.type, node.listStyleType, node.indent && `indent ${node.indent}`]
          .filter(Boolean)
          .join(" ");
        if (!leafBlock(node)) {
          walk(node.children!, [...path, i], [...within, kind]);
          continue;
        }
        const name = [...within, kind].join(" > ");
        model.push(`${name}: ${textOf(node, [...path, i]).replaceAll("\n", "↵")}`);
      }
    };
    walk(editor.children, [], []);
    if (active !== root) return [`focus: ${active?.tagName.toLowerCase() ?? "none"}`, ...model].join("\n");

    // What the page shows: Slate's text strings, and the DOM selection.
    const domSelection = getSelection()!;
    const block = '[data-slate-node="element"]:not([data-slate-inline])';
    const leafTexts = (within: Element) => {
      const found: Text[] = [];
      const walker = document.createTreeWalker(within, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (node.parentElement!.closest("[data-slate-string], [data-slate-zero-width]")) found.push(node);
      }
      return found;
    };
    // A caret between nodes shows at the start of the text after it.
    const all = leafTexts(root);
    const resolve = (node: globalThis.Node | null, offset: number): [globalThis.Node | null, number] => {
      if (!node || node.nodeType === globalThis.Node.TEXT_NODE) return [node, offset];
      const point = document.createRange();
      point.setStart(node, offset);
      const after = all.find((text) => point.comparePoint(text, 0) >= 0);
      return after ? [after, 0] : [all.at(-1) ?? null, all.at(-1)?.length ?? 0];
    };
    const [anchor, anchorOffset] = resolve(domSelection.anchorNode, domSelection.anchorOffset);
    const [focus, focusOffset] = resolve(domSelection.focusNode, domSelection.focusOffset);
    const dom: string[] = [];
    for (const element of root.querySelectorAll(block)) {
      if (element.querySelector(block)) continue;
      const nodes = leafTexts(element).filter((node) => node.parentElement!.closest(block) === element);
      let line = "";
      for (const [i, node] of nodes.entries()) {
        let text = node.parentElement!.closest("[data-slate-string]") ? node.data : "";
        // Slate shows one more line break after a block's last one.
        if (i === nodes.length - 1 && text.endsWith("\n")) text = text.slice(0, -1);
        const marks: [number, string][] = [];
        if (node === anchor) marks.push([Math.min(anchorOffset, text.length), "|"]);
        if (!domSelection.isCollapsed && node === focus) marks.push([Math.min(focusOffset, text.length), "^"]);
        line += mark(text, marks);
      }
      dom.push(line);
    }

    const textOnly = model.map((line) => line.slice(line.indexOf(": ") + 2));
    return textOnly.join("\n") === dom.join("\n")
      ? model.join("\n")
      : `${model.join("\n")}\n-- the page shows --\n${dom.join("\n")}`;
  });
}

/** Waits for `view` to show `expected`, one line per item. */
async function expectCaret(page: Page, expected: string[], view = caretView) {
  await expect.poll(() => view(page)).toBe(expected.join("\n"));
}

/** Waits until the page's caret and the editor's are the same. */
async function caretSettled(page: Page) {
  await expect.poll(() => caretView(page)).not.toContain("-- the page shows --");
}

/**
 * Presses a key once the editor has the caret the last key left. Keys the
 * browser handles move the page's caret first, and the editor takes it a
 * moment later; a key before then would act on the old caret.
 */
async function press(page: Page, key: string) {
  await caretSettled(page);
  await page.keyboard.press(key);
}

/**
 * Types a letter and checks it went in at the caret, which then sits after
 * it: what you see is where the next key lands. Typing in the shard's
 * empty last line adds another, which isn't checked.
 */
async function typeAtCaret(page: Page) {
  const withoutEmptyEnd = (view: string) => view.replace(/(\np: )+$/, "");
  const before = await caretView(page);
  expect(before, "a single caret to type at").toMatch(/^[^|]*\|[^|^]*$/);
  const [left, right] = withoutEmptyEnd(before).split("|");
  await page.keyboard.type("X");
  await expect
    .poll(async () => withoutEmptyEnd(await caretView(page)))
    .toBe(`${left}X|${right}`);
}

/**
 * Puts the caret at the start, at an offset, or at the end of the block
 * whose text is `text`. It moves there with arrow keys, which the editor
 * handles itself: a key the browser handles moves the page's caret first,
 * and a render before the editor takes it puts the old one back.
 */
async function caretIn(page: Page, text: string, at: "start" | "end" | number) {
  await caretAfter(page, text);
  const offset = at === "start" ? 0 : at === "end" ? text.length : at;
  for (let i = offset; i < text.length; i += 1) await press(page, "ArrowLeft");
  await caretSettled(page);
}

/** Selects the next `count` characters from the caret. */
async function selectRight(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) await press(page, "Shift+ArrowRight");
}

// Typing and line keys at the start, middle and end of every kind of block.

/** The three blocks' texts: one for each place the caret goes. */
const WORDS = ["alpha", "bravo", "delta"] as const;
const PLACES = ["start", 2, "end"] as const;

const BLOCKS: Record<string, string> = {
  paragraph: WORDS.join("\n\n"),
  heading: WORDS.map((word) => `## ${word}`).join("\n\n"),
  "list item": WORDS.map((word) => `- ${word}`).join("\n"),
  quote: WORDS.map((word) => `> ${word}`).join("\n\n"),
  callout: WORDS.map((word) => `> [!note]\n> ${word}`).join("\n\n"),
  toggle: WORDS.map((word) => `<details>\n<summary>${word}</summary>\n\n</details>`).join("\n\n"),
  "table cell": `| ${WORDS.join(" | ")} |\n| - | - | - |\n| a | b | c |`,
  "code block": WORDS.map((word) => `\`\`\`\n${word}\n\`\`\``).join("\n\n"),
};

const KEYS = ["type", "Backspace", "Delete", "Enter", "Shift+Enter"] as const;

/**
 * What the shard shows after each key at the start of the first block, in
 * the middle of the second and at the end of the third, in turn. Recorded
 * from the editor as it behaves; any change here is a change in behavior.
 */
const AFTER: Record<string, Record<string, string[][]>> = {
  paragraph: {
    type: [
      ["p: Top", "p: Y|alpha", "p: bravo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: YXalpha", "p: brY|avo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: YXalpha", "p: brYXavo", "p: deltaY|", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top|alpha", "p: bravo", "p: delta", "p: End", "p: "],
      ["p: TopXalpha", "p: b|avo", "p: delta", "p: End", "p: "],
      ["p: TopXalpha", "p: bXavo", "p: delt|", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "p: |lpha", "p: bravo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: Xlpha", "p: br|vo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: Xlpha", "p: brXvo", "p: delta|End", "p: "],
    ],
    Enter: [
      ["p: Top", "p: ", "p: |alpha", "p: bravo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: ", "p: Xalpha", "p: br", "p: |avo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: ", "p: Xalpha", "p: br", "p: Xavo", "p: delta", "p: |", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "p: ↵|alpha", "p: bravo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: ↵Xalpha", "p: br↵|avo", "p: delta", "p: End", "p: "],
      ["p: Top", "p: ↵Xalpha", "p: br↵Xavo", "p: delta↵|", "p: End", "p: "],
    ],
  },
  heading: {
    type: [
      ["p: Top", "h2: Y|alpha", "h2: bravo", "h2: delta", "p: End", "p: "],
      ["p: Top", "h2: YXalpha", "h2: brY|avo", "h2: delta", "p: End", "p: "],
      ["p: Top", "h2: YXalpha", "h2: brYXavo", "h2: deltaY|", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top", "p: |alpha", "h2: bravo", "h2: delta", "p: End", "p: "],
      ["p: Top", "p: Xalpha", "h2: b|avo", "h2: delta", "p: End", "p: "],
      ["p: Top", "p: Xalpha", "h2: bXavo", "h2: delt|", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "h2: |lpha", "h2: bravo", "h2: delta", "p: End", "p: "],
      ["p: Top", "h2: Xlpha", "h2: br|vo", "h2: delta", "p: End", "p: "],
      ["p: Top", "h2: Xlpha", "h2: brXvo", "h2: delta|End", "p: "],
    ],
    Enter: [
      ["p: Top", "p: ", "h2: |alpha", "h2: bravo", "h2: delta", "p: End", "p: "],
      ["p: Top", "p: ", "h2: Xalpha", "h2: br", "p: |avo", "h2: delta", "p: End", "p: "],
      ["p: Top", "p: ", "h2: Xalpha", "h2: br", "p: Xavo", "h2: delta", "p: |", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "h2: ↵|alpha", "h2: bravo", "h2: delta", "p: End", "p: "],
      ["p: Top", "h2: ↵Xalpha", "h2: br↵|avo", "h2: delta", "p: End", "p: "],
      ["p: Top", "h2: ↵Xalpha", "h2: br↵Xavo", "h2: delta↵|", "p: End", "p: "],
    ],
  },
  "list item": {
    type: [
      ["p: Top", "p disc indent 1: Y|alpha", "p disc indent 1: bravo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: YXalpha", "p disc indent 1: brY|avo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: YXalpha", "p disc indent 1: brYXavo", "p disc indent 1: deltaY|", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top", "p: |alpha", "p disc indent 1: bravo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p: Xalpha", "p disc indent 1: b|avo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p: Xalpha", "p disc indent 1: bXavo", "p disc indent 1: delt|", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "p disc indent 1: |lpha", "p disc indent 1: bravo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: Xlpha", "p disc indent 1: br|vo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: Xlpha", "p disc indent 1: brXvo", "p disc indent 1: delta|End", "p: "],
    ],
    Enter: [
      ["p: Top", "p disc indent 1: ", "p disc indent 1: |alpha", "p disc indent 1: bravo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: ", "p disc indent 1: Xalpha", "p disc indent 1: br", "p disc indent 1: |avo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: ", "p disc indent 1: Xalpha", "p disc indent 1: br", "p disc indent 1: Xavo", "p disc indent 1: delta", "p disc indent 1: |", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "p disc indent 1: ↵|alpha", "p disc indent 1: bravo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: ↵Xalpha", "p disc indent 1: br↵|avo", "p disc indent 1: delta", "p: End", "p: "],
      ["p: Top", "p disc indent 1: ↵Xalpha", "p disc indent 1: br↵Xavo", "p disc indent 1: delta↵|", "p: End", "p: "],
    ],
  },
  quote: {
    type: [
      ["p: Top", "blockquote > p: Y|alpha", "blockquote > p: bravo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: YXalpha", "blockquote > p: brY|avo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: YXalpha", "blockquote > p: brYXavo", "blockquote > p: deltaY|", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top", "p: |alpha", "blockquote > p: bravo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "p: Xalpha", "blockquote > p: b|avo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "p: Xalpha", "blockquote > p: bXavo", "blockquote > p: delt|", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "blockquote > p: |lpha", "blockquote > p: bravo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: Xlpha", "blockquote > p: br|vo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: Xlpha", "blockquote > p: brXvo", "blockquote > p: delta|End", "p: "],
    ],
    Enter: [
      ["p: Top", "blockquote > p: ", "blockquote > p: |alpha", "blockquote > p: bravo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: ", "blockquote > p: Xalpha", "blockquote > p: br", "blockquote > p: |avo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: ", "blockquote > p: Xalpha", "blockquote > p: br", "blockquote > p: Xavo", "blockquote > p: delta", "blockquote > p: |", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "blockquote > p: ↵|alpha", "blockquote > p: bravo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: ↵Xalpha", "blockquote > p: br↵|avo", "blockquote > p: delta", "p: End", "p: "],
      ["p: Top", "blockquote > p: ↵Xalpha", "blockquote > p: br↵Xavo", "blockquote > p: delta↵|", "p: End", "p: "],
    ],
  },
  callout: {
    type: [
      ["p: Top", "callout > p: Y|alpha", "callout > p: bravo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: YXalpha", "callout > p: brY|avo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: YXalpha", "callout > p: brYXavo", "callout > p: deltaY|", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top|alpha", "callout > p: bravo", "callout > p: delta", "p: End", "p: "],
      ["p: TopXalpha", "callout > p: b|avo", "callout > p: delta", "p: End", "p: "],
      ["p: TopXalpha", "callout > p: bXavo", "callout > p: delt|", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "callout > p: |lpha", "callout > p: bravo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: Xlpha", "callout > p: br|vo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: Xlpha", "callout > p: brXvo", "callout > p: delta|End", "p: "],
    ],
    Enter: [
      ["p: Top", "callout > p: ", "callout > p: |alpha", "callout > p: bravo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: ", "callout > p: Xalpha", "callout > p: br", "callout > p: |avo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: ", "callout > p: Xalpha", "callout > p: br", "callout > p: Xavo", "callout > p: delta", "callout > p: |", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "callout > p: ↵|alpha", "callout > p: bravo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: ↵Xalpha", "callout > p: br↵|avo", "callout > p: delta", "p: End", "p: "],
      ["p: Top", "callout > p: ↵Xalpha", "callout > p: br↵Xavo", "callout > p: delta↵|", "p: End", "p: "],
    ],
  },
  toggle: {
    type: [
      ["p: Top", "toggle: Y|alpha", "p: ", "toggle: bravo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: YXalpha", "p: ", "toggle: brY|avo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: YXalpha", "p: ", "toggle: brYXavo", "p: ", "toggle: deltaY|", "p: ", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top|alpha", "p: ", "toggle: bravo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: TopXalpha", "p: ", "toggle: b|avo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: TopXalpha", "p: ", "toggle: bXavo", "p: ", "toggle: delt|", "p: ", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "toggle: |lpha", "p: ", "toggle: bravo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: Xlpha", "p: ", "toggle: br|vo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: Xlpha", "p: ", "toggle: brXvo", "p: ", "toggle: delta|", "p: End", "p: "],
    ],
    Enter: [
      ["p: Top", "toggle: ", "toggle: |alpha", "p: ", "toggle: bravo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: ", "toggle: Xalpha", "p: ", "toggle: br", "toggle: |avo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: ", "toggle: Xalpha", "p: ", "toggle: br", "toggle: Xavo", "p: ", "toggle: delta", "toggle: |", "p: ", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "toggle: ↵|alpha", "p: ", "toggle: bravo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: ↵Xalpha", "p: ", "toggle: br↵|avo", "p: ", "toggle: delta", "p: ", "p: End", "p: "],
      ["p: Top", "toggle: ↵Xalpha", "p: ", "toggle: br↵Xavo", "p: ", "toggle: delta↵|", "p: ", "p: End", "p: "],
    ],
  },
  "table cell": {
    type: [
      ["p: Top", "table > tr > th > p: Y|alpha", "table > tr > th > p: bravo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: YXalpha", "table > tr > th > p: brY|avo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: YXalpha", "table > tr > th > p: brYXavo", "table > tr > th > p: deltaY|", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top|alpha", "table > tr > th > p: ", "table > tr > th > p: bravo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: TopXalpha", "table > tr > th > p: ", "table > tr > th > p: b|avo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: TopXalpha", "table > tr > th > p: ", "table > tr > th > p: bXavo", "table > tr > th > p: delt|", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "table > tr > th > p: |lpha", "table > tr > th > p: bravo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: Xlpha", "table > tr > th > p: br|vo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: Xlpha", "table > tr > th > p: brXvo", "table > tr > th > p: delta|a", "table > tr > td > p: ", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
    ],
    Enter: [
      ["p: Top", "table > tr > th > p: ", "table > tr > th > p: |alpha", "table > tr > th > p: bravo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: ", "table > tr > th > p: Xalpha", "table > tr > th > p: br", "table > tr > th > p: |avo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: ", "table > tr > th > p: Xalpha", "table > tr > th > p: br", "table > tr > th > p: Xavo", "table > tr > th > p: delta", "table > tr > th > p: |", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "table > tr > th > p: ↵|alpha", "table > tr > th > p: bravo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: ↵Xalpha", "table > tr > th > p: br↵|avo", "table > tr > th > p: delta", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
      ["p: Top", "table > tr > th > p: ↵Xalpha", "table > tr > th > p: br↵Xavo", "table > tr > th > p: delta↵|", "table > tr > td > p: a", "table > tr > td > p: b", "table > tr > td > p: c", "p: End", "p: "],
    ],
  },
  "code block": {
    type: [
      ["p: Top", "code_block > code_line: Y|alpha", "code_block > code_line: bravo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: YXalpha", "code_block > code_line: brY|avo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: YXalpha", "code_block > code_line: brYXavo", "code_block > code_line: deltaY|", "p: End", "p: "],
    ],
    Backspace: [
      ["p: Top", "code_block > code_line: |alpha", "code_block > code_line: bravo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: Xalpha", "code_block > code_line: b|avo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: Xalpha", "code_block > code_line: bXavo", "code_block > code_line: delt|", "p: End", "p: "],
    ],
    Delete: [
      ["p: Top", "code_block > code_line: |lpha", "code_block > code_line: bravo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: Xlpha", "code_block > code_line: br|vo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: Xlpha", "code_block > code_line: brXvo", "code_block > code_line: delta|End", "p: "],
    ],
    Enter: [
      ["p: Top", "code_block > code_line: ", "code_block > code_line: |alpha", "code_block > code_line: bravo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: ", "code_block > code_line: Xalpha", "code_block > code_line: br", "code_block > code_line: |avo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: ", "code_block > code_line: Xalpha", "code_block > code_line: br", "code_block > code_line: Xavo", "code_block > code_line: delta", "code_block > code_line: |", "p: End", "p: "],
    ],
    "Shift+Enter": [
      ["p: Top", "code_block > code_line: ↵|alpha", "code_block > code_line: bravo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: ↵Xalpha", "code_block > code_line: br↵|avo", "code_block > code_line: delta", "p: End", "p: "],
      ["p: Top", "code_block > code_line: ↵Xalpha", "code_block > code_line: br↵Xavo", "code_block > code_line: delta↵|", "p: End", "p: "],
    ],
  },
  caption: {
    type: [
      ["Y|alpha"],
      ["brY|avo"],
      ["deltaY|"],
    ],
    Backspace: [
      ["|alpha"],
      ["b|avo"],
      ["delt|"],
    ],
    Delete: [
      ["|lpha"],
      ["br|vo"],
      ["delta|"],
    ],
    Enter: [
      ["", "|alpha"],
      ["br", "|avo"],
      ["delta", "|"],
    ],
    "Shift+Enter": [
      ["", "|alpha"],
      ["br", "|avo"],
      ["delta", "|"],
    ],
  },
  ime: {
    paragraph: [
      ["p: Top", "p: alpha 漢字|bravo", "p: "],
    ],
    cell: [
      ["p: Top", "table > tr > th > p: alpha 漢字|bravo", "table > tr > th > p: b", "table > tr > td > p: c", "table > tr > td > p: d", "p: "],
    ],
  },
  undo: {
    typing: [
      ["p: Top", "p: alpha |bravo", "p: charlie", "p: End", "p: "],
      ["p: Top", "p: alpha new |bravo", "p: charlie", "p: End", "p: "],
    ],
    paste: [
      ["p: Top", "p: alpha one", "p: two|bravo", "p: charlie", "p: End", "p: "],
      ["p: Top", "p: alpha |bravo", "p: charlie", "p: End", "p: "],
      ["p: Top", "p: alpha one", "p: two|bravo", "p: charlie", "p: End", "p: "],
    ],
    block: [
      ["p: Top", "p: alpha bravo|", "p: End", "p: "],
      ["p: Top", "p: alpha bravo", "p: |", "p: End", "p: "],
      ["p: Top", "p: alpha bravo", "p: |charlie^", "p: End", "p: "],
      ["p: Top", "p: alpha bravo", "p: |", "p: End", "p: "],
    ],
  },
  moved: {
    drag: [
      ["p: Top", "p: End|", "p: alpha", "p: bravo", "p disc indent 1: one", "p disc indent 1: two", "p: "],
    ],
    merge: [
      ["p: Top", "p: alpha|bravo", "p disc indent 1: one", "p disc indent 1: two", "p: End", "p: "],
    ],
    outside: [
      ["p: Top", "p: br|avo", "p disc indent 1: one", "p disc indent 1: two", "p: End", "p: "],
    ],
    heading: [
      ["p: Top", "p: alpha", "h2: br|avo", "p disc indent 1: one", "p disc indent 1: two", "p: End", "p: "],
    ],
    list: [
      ["p: Top", "p: alpha", "p disc indent 1: br|avo", "p disc indent 1: one", "p disc indent 1: two", "p: End", "p: "],
    ],
    toggle: [
      ["p: Top", "p: alpha", "toggle: br|avo", "p disc indent 1: one", "p disc indent 1: two", "p: End", "p: "],
    ],
    indent: [
      ["p: Top", "p: alpha", "p: bravo", "p disc indent 1: one", "p disc indent 2: t|wo", "p: End", "p: "],
      ["p: Top", "p: alpha", "p: bravo", "p disc indent 1: one", "p disc indent 1: tX|wo", "p: End", "p: "],
    ],
  },
  menus: {
    mentionEnter: [
      ["p: Top", "p: alpha  now|", "p: "],
    ],
    slash: [
      ["p: Top", "p: alpha", "h2: Title|", "p: "],
    ],
    mentionClick: [
      ["p: Top", "p: alpha  now|", "p: "],
    ],
  },
  long: {
    ctrlEnd: [
      ["p: |"],
    ],
    selectAll: [
      ["p: X|", "p: "],
    ],
  },
};

for (const [kind, markdown] of Object.entries(BLOCKS)) {
  test.describe(`in a ${kind}`, () => {
    for (const key of KEYS) {
      test(`${key} at the start, middle and end`, async ({ page }) => {
        await mockVault(page, {
          files: { "Blocks.md": `Top\n\n${markdown}\n\nEnd\n` },
          open: "Blocks.md",
        });
        for (const [i, place] of PLACES.entries()) {
          await caretIn(page, WORDS[i], place);
          if (key === "type") await page.keyboard.type("Y");
          else await press(page, key);
          await expectCaret(page, AFTER[kind][key][i]);
          await typeAtCaret(page);
        }
      });
    }
  });
}

test.describe("in an image caption", () => {
  test.beforeEach(async ({ page }) => {
    await mockVault(page, {
      files: {
        "Media.md": `Top\n\n${WORDS.map((word) => `![${word}](_attachments/a.png)`).join("\n\n")}\n\nEnd\n`,
      },
      assets: { "_attachments/a.png": PNG },
      open: "Media.md",
    });
  });

  for (const key of KEYS) {
    test(`${key} at the start, middle and end`, async ({ page }) => {
      for (const [i, place] of PLACES.entries()) {
        await editor(page).locator("figcaption", { hasText: WORDS[i] }).locator("div").focus();
        await page.keyboard.press(place === "start" ? "Home" : "End");
        if (typeof place === "number") {
          await press(page, "Home");
          for (let step = 0; step < place; step += 1) await press(page, "ArrowRight");
        }
        if (key === "type") await page.keyboard.type("Y");
        else await page.keyboard.press(key);
        await expectCaret(page, AFTER.caption[key][i]);
        await typeAtCaret(page);
      }
    });
  }
});

test.describe("composing with an input method", () => {
  /** Composes 漢字 from kana, as a Japanese input method does. */
  async function compose(page: Page) {
    const cdp = await page.context().newCDPSession(page);
    for (const text of ["か", "かん", "かんじ"]) {
      await cdp.send("Input.imeSetComposition", {
        text,
        selectionStart: text.length,
        selectionEnd: text.length,
      });
    }
    await cdp.send("Input.imeSetComposition", { text: "漢字", selectionStart: 2, selectionEnd: 2 });
    await cdp.send("Input.insertText", { text: "漢字" });
  }

  test("in a paragraph", async ({ page }) => {
    await mockVault(page, { files: { "Note.md": "Top\n\nalpha bravo\n" }, open: "Note.md" });
    await caretIn(page, "alpha bravo", 6);
    await compose(page);
    await expectCaret(page, AFTER.ime.paragraph[0]);
    await typeAtCaret(page);
  });

  test("in a table cell", async ({ page }) => {
    await mockVault(page, {
      files: { "Note.md": "Top\n\n| alpha bravo | b |\n| - | - |\n| c | d |\n" },
      open: "Note.md",
    });
    await caretIn(page, "alpha bravo", 6);
    await compose(page);
    await expectCaret(page, AFTER.ime.cell[0]);
    await typeAtCaret(page);
  });
});

test.describe("undo and redo", () => {
  test.beforeEach(async ({ page }) => {
    await mockVault(page, {
      files: { "Note.md": "Top\n\nalpha bravo\n\ncharlie\n\nEnd\n" },
      open: "Note.md",
    });
  });

  test("after typing", async ({ page }) => {
    await caretIn(page, "alpha bravo", 6);
    await page.keyboard.type("new ");
    await press(page, "ControlOrMeta+z");
    await expectCaret(page, AFTER.undo.typing[0]);
    await press(page, "ControlOrMeta+Shift+z");
    await expectCaret(page, AFTER.undo.typing[1]);
    await typeAtCaret(page);
  });

  test("after a paste", async ({ page }) => {
    await caretIn(page, "alpha bravo", 6);
    await paste(page, { text: "one\n\ntwo " });
    await expectCaret(page, AFTER.undo.paste[0]);
    await press(page, "ControlOrMeta+z");
    await expectCaret(page, AFTER.undo.paste[1]);
    await press(page, "ControlOrMeta+Shift+z");
    await expectCaret(page, AFTER.undo.paste[2]);
    await typeAtCaret(page);
  });

  test("after deleting a block", async ({ page }) => {
    // Select the whole block's text and delete it, then the empty block.
    await caretIn(page, "charlie", "start");
    await selectRight(page, "charlie".length);
    await press(page, "Backspace");
    await press(page, "Backspace");
    await expectCaret(page, AFTER.undo.block[0]);
    await press(page, "ControlOrMeta+z");
    await expectCaret(page, AFTER.undo.block[1]);
    await press(page, "ControlOrMeta+z");
    await expectCaret(page, AFTER.undo.block[2]);
    await press(page, "ControlOrMeta+Shift+z");
    await expectCaret(page, AFTER.undo.block[3]);
    await typeAtCaret(page);
  });
});

test.describe("when blocks move under the caret", () => {
  const FILE = "Top\n\nalpha\n\nbravo\n\n- one\n- two\n\nEnd\n";

  test.beforeEach(async ({ page }) => {
    await mockVault(page, { files: { "Note.md": FILE }, open: "Note.md" });
  });

  test("a block dragged above the caret's block", async ({ page }) => {
    await caretIn(page, "bravo", 2);
    const handleOf = async (text: string) => {
      const block = editor(page).locator("[data-slate-node='element']", { hasText: text }).last();
      await block.hover();
      return page.locator("[data-plate-prevent-deselect]").filter({ visible: true }).first();
    };
    const handle = await handleOf("End");
    const target = (await editor(page).getByText("alpha", { exact: true }).boundingBox())!;
    await handle.hover();
    await page.mouse.down();
    // The top half of a block drops above it.
    await page.mouse.move(target.x + 10, target.y + target.height / 4, { steps: 10 });
    await page.mouse.up();
    // The dropped block stays selected and takes the keys, as after a click
    // on its handle: Enter puts the caret at its end.
    await press(page, "Enter");
    await expectCaret(page, AFTER.moved.drag[0]);
    await typeAtCaret(page);
  });

  test("the block above deleted into", async ({ page }) => {
    // Backspace at the start of a block takes it into the block above.
    await caretIn(page, "bravo", "start");
    await press(page, "Backspace");
    await expectCaret(page, AFTER.moved.merge[0]);
    await typeAtCaret(page);
  });

  test("the block above removed by another app", async ({ page }) => {
    await caretIn(page, "bravo", 2);
    await changeOutside(page, "Note.md", FILE.replace("alpha\n\n", ""));
    await expect(editor(page)).not.toContainText("alpha");
    await expectCaret(page, AFTER.moved.outside[0]);
    await typeAtCaret(page);
  });

  test("the caret's block turned into a heading by its shortcut", async ({ page }) => {
    await caretIn(page, "bravo", 2);
    await press(page, "ControlOrMeta+Alt+2");
    await expectCaret(page, AFTER.moved.heading[0]);
    await typeAtCaret(page);
  });

  test("the caret's block turned into a list from Turn into", async ({ page }) => {
    await caretIn(page, "bravo", 2);
    await page.getByRole("toolbar").first().getByRole("radio").filter({ hasText: "Text" }).click();
    await page.getByRole("menuitemradio", { name: "Bulleted list" }).click();
    await menuClosed(page);
    await expectCaret(page, AFTER.moved.list[0]);
    await typeAtCaret(page);
  });

  test("the caret's block turned into a toggle from Turn into", async ({ page }) => {
    await caretIn(page, "bravo", 2);
    await page.getByRole("toolbar").first().getByRole("radio").filter({ hasText: "Text" }).click();
    await page.getByRole("menuitemradio", { name: "Toggle list" }).click();
    await menuClosed(page);
    await expectCaret(page, AFTER.moved.toggle[0]);
    await typeAtCaret(page);
  });

  test("a list item indented and outdented", async ({ page }) => {
    await caretIn(page, "two", 1);
    await press(page, "Tab");
    await expectCaret(page, AFTER.moved.indent[0]);
    await typeAtCaret(page);
    await press(page, "Shift+Tab");
    await expectCaret(page, AFTER.moved.indent[1]);
    await typeAtCaret(page);
  });
});

test.describe("menus that put a node at the caret", () => {
  const FILES = {
    "Note.md": "Top\n\nalpha\n",
    "Other Note.md": "# Other Note\n",
  };

  test.beforeEach(async ({ page }) => {
    await mockVault(page, { files: FILES, open: "Note.md" });
    await caretIn(page, "alpha", "end");
  });

  test("an @ link picked with Enter", async ({ page }) => {
    await page.keyboard.type(" @Oth");
    await pickOption(page, page.getByRole("option", { name: "Other Note" }));
    await page.keyboard.type(" now");
    await expectCaret(page, AFTER.menus.mentionEnter[0]);
    await typeAtCaret(page);
  });

  test("an @ link picked with a click", async ({ page }) => {
    await page.keyboard.type(" @Oth");
    await page.getByRole("option", { name: "Other Note" }).click();
    await menuClosed(page);
    await page.keyboard.type(" now");
    await expectCaret(page, AFTER.menus.mentionClick[0]);
    await typeAtCaret(page);
  });

  test("a block from the / menu", async ({ page }) => {
    await press(page, "Enter");
    await page.keyboard.type("/h2");
    await pickOption(page, page.getByRole("option", { name: "Heading 2", exact: true }));
    await page.keyboard.type("Title");
    await expectCaret(page, AFTER.menus.slash[0]);
    await typeAtCaret(page);
  });
});

test.describe("in a long shard", () => {
  const SECTIONS = 120;

  function longShard() {
    let markdown = "# Long\n\n";
    for (let i = 0; i < SECTIONS; i += 1) {
      markdown += `## Section ${i}\n\nText ${i} #tag${i}\n\n| a | b |\n| - | - |\n| ${i} | row ${i} |\n\n`;
    }
    return markdown;
  }

  /** The caret's block, as `caretView` shows it, without the rest of the shard. */
  async function caretLine(page: Page) {
    return (await caretView(page))
      .split("\n")
      .filter((line) => /[|^]/.test(line))
      .join("\n");
  }

  test.beforeEach(async ({ page }) => {
    // Tags lists the long shard's tag, as the index would.
    await page.addInitScript((vaultPath) => {
      type Bridge = { invoke: (command: string, args?: unknown) => unknown };
      let bridge: Bridge | undefined;
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        configurable: true,
        get: () => bridge,
        set: (value: Bridge) => {
          const invoke = value.invoke;
          value.invoke = async (command, args) =>
            command === "get_tagged_files"
              ? [
                  {
                    path: `${vaultPath}/Long.md`,
                    name: "Long.md",
                    last_modified: 0,
                    tags: [{ tag: "tag100", excerpt: null }],
                  },
                ]
              : invoke(command, args);
          bridge = value;
        },
      });
    }, VAULT_PATH);
    await mockVault(page, {
      files: { "Small.md": "# Small\n\nHi\n", "Long.md": longShard() },
      open: "Small.md",
    });
    await expect(editor(page)).toContainText("Hi");
    await openShard(page, "Long");
    await caretIn(page, "Text 0", "end");
  });

  test("Select all, then typing", async ({ page }) => {
    await press(page, "ControlOrMeta+a");
    await page.keyboard.type("X");
    await expectCaret(page, AFTER.long.selectAll[0]);
    await typeAtCaret(page);
  });

  test("Ctrl+End, then typing", async ({ page }) => {
    await press(page, "ControlOrMeta+End");
    await expectCaret(page, AFTER.long.ctrlEnd[0], caretLine);
    await typeAtCaret(page);
  });

  test("a jump from the outline, then typing", async ({ page }) => {
    await page.getByRole("button", { name: "Show right sidebar" }).click();
    await page
      .getByRole("navigation", { name: "Outline" })
      .getByRole("button", { name: "Section 100", exact: true })
      .click();
    await expectCaret(page, ["h2: |Section 100"], caretLine);
    await typeAtCaret(page);
  });

  test("a jump to a tag, then typing", async ({ page }) => {
    await page.getByRole("button", { name: "Tags", exact: true }).click();
    await page.getByRole("button", { name: /^Long/ }).click();
    await expectCaret(page, ["p: Text 100 |#tag100^"], caretLine);
    await page.keyboard.type("X");
    await expectCaret(page, ["p: Text 100 X|"], caretLine);
    await typeAtCaret(page);
  });
});

test.describe("other text boxes keep their caret", () => {
  const NOTE = "Top\n\nalpha\n\n![x](_attachments/a.png)\n\n";
  const READY = {
    provider: true,
    vaultAllowed: true,
    picked: true,
    answer: ["Done."],
    reads: [],
    inline: ["Done."],
    memory: ["alpha bravo"],
  };

  /**
   * Types in the middle of `box`'s text, makes the app re-render around it
   * with an outside change to the open shard, then types again.
   */
  async function typeInMiddle(page: Page, box: import("@playwright/test").Locator) {
    const before = "alpha ";
    await box.fill(`${before}bravo`);
    await box.press("Home");
    for (let i = 0; i < before.length; i += 1) await box.press("ArrowRight");
    await page.keyboard.type("new ");
    await expectCaret(page, ["alpha new |bravo"]);
    await changeOutside(page, "Note.md", `${NOTE}More\n`);
    await expect(editor(page)).toContainText("More");
    await expectCaret(page, ["alpha new |bravo"]);
    await typeAtCaret(page);
  }

  test.beforeEach(async ({ page }) => {
    await mockVault(page, {
      files: { "Note.md": NOTE },
      assets: { "_attachments/a.png": PNG },
      open: "Note.md",
      assistant: READY,
    });
  });

  test("the assistant's message box", async ({ page }) => {
    await page.getByRole("button", { name: "Show assistant" }).click();
    const box = page.getByRole("complementary", { name: "Assistant" }).getByRole("textbox", { name: "Message" });
    await typeInMiddle(page, box);
  });

  test("an image caption", async ({ page }) => {
    const caption = editor(page).locator("figcaption");
    await caption.locator("div").focus();
    await typeInMiddle(page, caption.locator("textarea"));
  });

  test("the inline Ask prompt", async ({ page }) => {
    await caretIn(page, "alpha", "start");
    await selectRight(page, "alpha".length);
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await typeInMiddle(page, page.getByRole("textbox", { name: "Ask about the selection" }));
  });

  test("search", async ({ page }) => {
    await page.keyboard.press("ControlOrMeta+k");
    await typeInMiddle(page, page.getByRole("dialog", { name: "Search" }).getByPlaceholder("Search your vault"));
  });

  test("a settings box", async ({ page }) => {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "AI assistant" }).click();
    const items = page.getByRole("list", { name: "Memory items" });
    await items.getByRole("button", { name: "Edit" }).first().click();
    await typeInMiddle(page, items.getByRole("textbox", { name: "Memory item" }));
  });
});

/** Sections in the shard typed into: enough text that a walk stands out. */
const LONG_SECTIONS = 200;
/**
 * A walk reads every text node drawn in the editor; the editor's own reads
 * for one key touch a few around the caret. A tenth of them leaves room for
 * those and still catches a walk.
 */
const WALK_SHARE = 0.1;

test("typing in a long shard doesn't walk the editor's text", async ({ page }) => {
  // React's selection save before each commit reads every text node's value
  // in the focused editor; the react-dom patch skips it for the editor.
  // Only the app's own reads count: a test trace reads every node too.
  await page.addInitScript(() => {
    const value = Object.getOwnPropertyDescriptor(Node.prototype, "nodeValue")!;
    const counted = window as unknown as { __nodeValueReads: number };
    const appCode = `${location.origin}/assets/`;
    counted.__nodeValueReads = 0;
    Object.defineProperty(Node.prototype, "nodeValue", {
      ...value,
      get() {
        if (new Error().stack?.includes(appCode)) counted.__nodeValueReads += 1;
        return value.get!.call(this);
      },
    });
  });
  let markdown = "# Long\n\n";
  for (let i = 0; i < LONG_SECTIONS; i += 1) markdown += `## Section ${i}\n\nText ${i} with **bold** and _italic_.\n\n`;
  await mockVault(page, { files: { "Long.md": markdown }, open: "Long.md" });
  await caretIn(page, "Text 1 with", "end");

  const textNodes = await editor(page).evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode()) count += 1;
    return count;
  });
  await page.evaluate(() => {
    (window as unknown as { __nodeValueReads: number }).__nodeValueReads = 0;
  });
  await page.keyboard.type("X");
  await expectCaret(page, ["p: Text 1 with bold and italic.X|"], async (page) =>
    (await caretView(page)).split("\n").filter((line) => line.includes("|")).join("\n"),
  );
  const reads = await page.evaluate(
    () => (window as unknown as { __nodeValueReads: number }).__nodeValueReads,
  );
  expect(reads).toBeLessThan(textNodes * WALK_SHARE);
});
