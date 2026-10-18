// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { createPlateEditor, type PlateEditor } from "platejs/react";
import { KEYS, type TElement, type TText } from "platejs";
import { describe, expect, it } from "vitest";
import { insertBlock, insertInlineElement } from "@/components/transforms";
import { EditorKit } from "@/components/editor/editor-kit";
import {
  deserializeEditorMarkdown,
  serializeEditorMarkdown,
} from "@/lib/editor-markdown";

/**
 * Every block and mark the editor offers (slash menu, insert and turn-into
 * menus, toolbars) is inserted into a real editor, saved as Markdown and
 * loaded again. A feature that comes back changed has no working save rule,
 * which is how toggles lost their text unnoticed. Adding a menu item without
 * a case here fails the guard test at the bottom.
 */

const PROBE = "probe text";

type BlockCase = {
  /** The menu value, as the slash and insert menus pass it to `insertBlock`. */
  value: string;
  /** The element type expected back after a save and load. */
  type?: string;
  /** Props that must survive the round trip, besides the type. */
  props?: Record<string, unknown>;
  /**
   * Inserts the element the way the app does when the menu item needs more
   * than one step (media goes through a file picker first).
   */
  insert?: (editor: PlateEditor) => void;
  /** Prepares the inserted element before saving (void blocks need content). */
  prepare?: (editor: PlateEditor) => void;
  /** Blocks that hold no text (rules, media, TOC). */
  void?: boolean;
};

const BLOCKS: BlockCase[] = [
  { value: KEYS.p },
  { value: "h1" },
  { value: "h2" },
  { value: "h3" },
  { value: "h4" },
  { value: "h5" },
  { value: "h6" },
  { value: KEYS.ul, type: KEYS.p, props: { listStyleType: KEYS.ul } },
  { value: KEYS.ol, type: KEYS.p, props: { listStyleType: KEYS.ol } },
  { value: KEYS.codeBlock, type: KEYS.codeBlock },
  { value: KEYS.blockquote },
  { value: KEYS.callout, props: { icon: "💡" } },
  { value: KEYS.table },
  { value: KEYS.hr, void: true },
  { value: KEYS.toc, void: true },
  { value: "action_three_columns", type: KEYS.columnGroup },
  {
    value: KEYS.equation,
    void: true,
    props: { texExpression: "x^2" },
    prepare: (editor) =>
      editor.tf.setNodes(
        { texExpression: "x^2" },
        { match: (n) => (n as TElement).type === KEYS.equation, at: [] },
      ),
  },
  {
    value: KEYS.img,
    void: true,
    props: { url: "attachments/picture.png" },
    insert: (editor) => insertMedia(editor, KEYS.img, "attachments/picture.png"),
  },
  {
    value: KEYS.video,
    void: true,
    props: { url: "attachments/clip.mp4" },
    insert: (editor) => insertMedia(editor, KEYS.video, "attachments/clip.mp4"),
  },
  {
    value: KEYS.audio,
    void: true,
    props: { url: "attachments/clip.mp3" },
    insert: (editor) => insertMedia(editor, KEYS.audio, "attachments/clip.mp3"),
  },
  {
    value: KEYS.file,
    void: true,
    props: { url: "attachments/doc.pdf" },
    insert: (editor) => insertMedia(editor, KEYS.file, "attachments/doc.pdf"),
  },
  {
    value: KEYS.mediaEmbed,
    void: true,
    props: { url: "https://example.com/embed" },
    insert: (editor) => insertMedia(editor, KEYS.mediaEmbed, "https://example.com/embed"),
  },
];

/**
 * Menu items whose save rule is still missing. Each one is a known data loss
 * tracked in the editor plan; the branch that fixes it moves the item up
 * into BLOCKS. Nothing else belongs here.
 */
const BLOCKS_WITHOUT_SAVE_RULE: Record<string, string> = {
  [KEYS.toggle]: "fix/markdown-data-loss saves toggles as <details>",
  [KEYS.listTodo]:
    "fix/markdown-data-loss saves an untouched to-do (checked undefined) as a task, not a bullet",
  [KEYS.codeDrawing]:
    "fix/markdown-data-loss decides whether code drawings get a rule or leave the menu",
};

type InlineCase = {
  value: string;
  type: string;
  props?: Record<string, unknown>;
  insert?: (editor: PlateEditor) => void;
  prepare?: (editor: PlateEditor) => void;
};

const INLINES: InlineCase[] = [
  { value: KEYS.date, type: KEYS.date },
  {
    value: KEYS.inlineEquation,
    type: KEYS.inlineEquation,
    props: { texExpression: "a+b" },
    prepare: (editor) =>
      editor.tf.setNodes(
        { texExpression: "a+b" },
        { match: (n) => (n as TElement).type === KEYS.inlineEquation, at: [] },
      ),
  },
  {
    // The link toolbar opens a floating form; the test inserts the node it
    // would create.
    value: KEYS.link,
    type: KEYS.link,
    props: { url: "https://example.com" },
    insert: (editor) =>
      editor.tf.insertNodes({
        type: KEYS.link,
        url: "https://example.com",
        children: [{ text: PROBE }],
      } as TElement),
  },
];

type MarkCase = { key: string; value?: unknown };

const MARKS: MarkCase[] = [
  { key: KEYS.bold },
  { key: KEYS.italic },
  { key: KEYS.underline },
  { key: KEYS.strikethrough },
  { key: KEYS.code },
  { key: KEYS.highlight },
  { key: KEYS.kbd },
  { key: KEYS.sub },
  { key: KEYS.sup },
  { key: KEYS.color, value: "#ff0000" },
  { key: KEYS.backgroundColor, value: "#ffff00" },
  { key: KEYS.fontSize, value: "24px" },
];

/**
 * Comments and suggestions are editing modes, not formatting: Markdown has
 * nowhere to keep them, so they are hidden until collaboration gives them
 * storage (editor plan, decided 2026-10-18).
 */
const MODE_KEYS = new Set<string>([KEYS.comment, KEYS.suggestion]);

/** The node the media toolbar inserts once a file is chosen or a URL entered. */
function insertMedia(editor: PlateEditor, type: string, url: string) {
  editor.tf.insertNodes({ type, url, children: [{ text: "" }] } as TElement);
}

function createEditor() {
  const editor = createPlateEditor({
    plugins: EditorKit,
    value: [{ type: KEYS.p, children: [{ text: "" }] }],
  });
  editor.tf.select(editor.api.start([])!);
  return editor;
}

function reload(editor: PlateEditor) {
  const markdown = serializeEditorMarkdown(editor);
  const loaded = createPlateEditor({
    plugins: EditorKit,
    value: deserializeEditorMarkdown(createEditor(), markdown),
  });
  return { markdown, value: loaded.children };
}

function findElement(nodes: unknown, predicate: (node: TElement) => boolean): TElement | null {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const element = node as TElement;
    if (typeof element.type === "string" && predicate(element)) return element;
    const inner = findElement(element.children, predicate);
    if (inner) return inner;
  }
  return null;
}

function findText(nodes: unknown, text: string): TText | null {
  if (!Array.isArray(nodes)) return null;
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const record = node as TText & TElement;
    if (typeof record.text === "string" && record.text.includes(text)) return record;
    const inner = findText(record.children, text);
    if (inner) return inner;
  }
  return null;
}

function matches(element: TElement, type: string, props: Record<string, unknown> = {}) {
  return (
    element.type === type &&
    Object.entries(props).every(([key, value]) => element[key] === value)
  );
}

describe("every block the editor can insert survives a save", () => {
  it.each(BLOCKS.map((block) => [block.value, block] as const))(
    "%s",
    (_value, block) => {
      const editor = createEditor();
      if (block.insert) block.insert(editor);
      else insertBlock(editor, block.value, { upsert: true });
      // A container block (blockquote) can leave the selection unset.
      if (!editor.selection) editor.tf.select(editor.api.start([0])!);
      block.prepare?.(editor);
      if (!block.void) editor.tf.insertText(PROBE);

      const type = block.type ?? block.value;
      const inserted = findElement(editor.children, (n) => matches(n, type, block.props));
      expect(inserted, `the editor inserted a ${type}`).not.toBeNull();

      const { markdown, value } = reload(editor);
      const restored = findElement(value, (n) => matches(n, type, block.props));
      expect(restored, `a ${type} came back from:\n${markdown}`).not.toBeNull();
      if (!block.void) {
        expect(findText(restored!.children, PROBE), `its text came back from:\n${markdown}`).not.toBeNull();
      }
    },
  );
});

describe("every inline element the editor can insert survives a save", () => {
  it.each(INLINES.map((inline) => [inline.value, inline] as const))(
    "%s",
    (_value, inline) => {
      const editor = createEditor();
      editor.tf.insertText("before ");
      if (inline.insert) inline.insert(editor);
      else insertInlineElement(editor, inline.value);
      inline.prepare?.(editor);

      const { markdown, value } = reload(editor);
      const restored = findElement(value, (n) => matches(n, inline.type, inline.props));
      expect(restored, `a ${inline.type} came back from:\n${markdown}`).not.toBeNull();
    },
  );
});

describe("every mark the toolbar offers survives a save", () => {
  it.each(MARKS.map((mark) => [mark.key, mark] as const))("%s", (_key, mark) => {
    const editor = createEditor();
    editor.tf.insertText("before ");
    editor.tf.addMark(mark.key, mark.value ?? true);
    editor.tf.insertText(PROBE);
    editor.tf.removeMark(mark.key);
    editor.tf.insertText(" after");

    const { markdown, value } = reload(editor);
    const leaf = findText(value, PROBE);
    expect(leaf, `the text came back from:\n${markdown}`).not.toBeNull();
    expect(leaf![mark.key], `the ${mark.key} mark came back from:\n${markdown}`).toBe(
      mark.value ?? true,
    );
  });
});

describe("menu coverage guard", () => {
  // Every feature key a menu or toolbar offers must have a case above.
  const UI_FILES = [
    "slash-node.tsx",
    "insert-toolbar-button.tsx",
    "turn-into-toolbar-button.tsx",
    "fixed-toolbar-buttons.tsx",
    "floating-toolbar-buttons.tsx",
    "more-toolbar-button.tsx",
    "font-size-toolbar-button.tsx",
    "font-color-toolbar-button.tsx",
  ];
  const UI_DIR = path.resolve(__dirname, "../ui");

  it("has a case for every menu and toolbar feature", () => {
    const covered = new Set<string>([
      ...BLOCKS.map((b) => b.value),
      ...Object.keys(BLOCKS_WITHOUT_SAVE_RULE),
      ...INLINES.map((i) => i.value),
      ...MARKS.map((m) => m.key),
      ...MODE_KEYS,
    ]);
    const offered = new Set<string>();

    for (const name of UI_FILES) {
      const source = fs.readFileSync(path.join(UI_DIR, name), "utf8");
      for (const [, key] of source.matchAll(/\bKEYS\.(\w+)/g)) {
        offered.add((KEYS as unknown as Record<string, string>)[key] ?? key);
      }
      for (const [, value] of source.matchAll(/value: ["'](h\d|action_\w+)["']/g)) {
        offered.add(value);
      }
    }

    const missing = [...offered].filter((key) => !covered.has(key)).sort();
    expect(missing, "menu features with no round-trip case").toEqual([]);
  });
});
