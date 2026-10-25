// @vitest-environment jsdom
import { createSlateEditor, NodeApi, type Descendant } from "platejs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SerializationKit } from "@/components/editor/serialization-kit";
import { fileExists, readMarkdownFile, saveMarkdownFile } from "@/lib/commands";
import {
  keepVersion,
  mergeOutsideValue,
  reloadOpenShardIfChanged,
  rememberSavedValue,
  showOutsideValue,
  takeOutsideChange,
} from "@/lib/outside-changes";
import { useEditorStore } from "@/store/editor";
import { loadMarkdown } from "@/test/markdown";

vi.mock("@/lib/commands", () => ({
  readMarkdownFile: vi.fn(),
  saveMarkdownFile: vi.fn(async () => {}),
  fileExists: vi.fn(async () => false),
}));

vi.mock("@/lib/editor-ast-cache", () => ({
  upsertAstCache: vi.fn(async () => {}),
}));

vi.mock("@/components/editor/lib/session-value", () => ({
  resolveSessionValue: async (_path: string, markdown: string) =>
    loadMarkdown(markdown),
}));

const NOTE = "C:/vault/Note.md";
const store = () => useEditorStore.getState();

function createEditor(markdown: string) {
  const editor = createSlateEditor({
    plugins: SerializationKit,
    value: loadMarkdown(markdown),
  });
  rememberSavedValue(editor, editor.children);
  return editor;
}

/** Opens `markdown` the way MountedEditor registers its editor. */
function openNote(markdown: string) {
  store().openFile({ path: NOTE, content: markdown });
  const editor = createEditor(markdown);
  store().setPlateEditor(editor);
  return editor;
}

function texts(editor: { children: Descendant[] }) {
  return editor.children.map((node) => NodeApi.string(node));
}

/** Changes the text of block `index`, as typing there would. */
function edit(editor: ReturnType<typeof createEditor>, index: number, text: string) {
  editor.tf.insertText(text, { at: editor.api.end([index])! });
  store().setIsDirty(true);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  store().closeFile();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("showOutsideValue", () => {
  it("replaces only the changed blocks and keeps the rest as they were", () => {
    const editor = createEditor("One\n\nTwo\n\nThree\n");
    const [first, , last] = editor.children;
    editor.tf.select(editor.api.end([2])!);

    showOutsideValue(editor, loadMarkdown("One\n\nTwo, changed\n\nThree\n"));

    expect(texts(editor)).toEqual(["One", "Two, changed", "Three"]);
    expect(editor.children[0]).toBe(first);
    expect(editor.children[2]).toBe(last);
    expect(editor.selection?.anchor.path[0]).toBe(2);
    expect(editor.history.undos).toEqual([]);
  });

  it("adds and removes blocks", () => {
    const editor = createEditor("One\n\nTwo\n");
    showOutsideValue(editor, loadMarkdown("Zero\n\nOne\n"));
    expect(texts(editor)).toEqual(["Zero", "One"]);
  });
});

describe("mergeOutsideValue", () => {
  const saved = "One\n\nTwo\n\nThree\n\nFour\n";

  function merge(edited: number, outside: string) {
    const editor = createEditor(saved);
    const before = editor.children;
    edit(editor, edited, "!");
    const merged = mergeOutsideValue(
      editor,
      before,
      loadMarkdown(saved),
      loadMarkdown(outside),
    );
    return { editor, merged: merged !== null };
  }

  it("keeps edits and brings in an outside change after them", () => {
    const { editor, merged } = merge(0, "One\n\nTwo\n\nThree\n\nFour, outside\n");
    expect(merged).toBe(true);
    expect(texts(editor)).toEqual(["One!", "Two", "Three", "Four, outside"]);
  });

  it("keeps edits and brings in an outside change before them", () => {
    const { editor, merged } = merge(3, "Zero\n\nOne\n\nTwo\n\nThree\n\nFour\n");
    expect(merged).toBe(true);
    expect(texts(editor)).toEqual(["Zero", "One", "Two", "Three", "Four!"]);
  });

  it("lines up with an empty last paragraph the editor added", () => {
    const editor = createEditor(saved);
    editor.tf.insertNodes({ type: "p", children: [{ text: "" }] }, { at: [4] });
    const before = editor.children;
    edit(editor, 0, "!");

    expect(
      mergeOutsideValue(
        editor,
        before,
        loadMarkdown(saved),
        loadMarkdown("One\n\nTwo\n\nThree\n\nFour, outside\n"),
      ),
    ).not.toBeNull();
    expect(texts(editor)).toEqual(["One!", "Two", "Three", "Four, outside", ""]);
  });

  it("changes nothing when both changed the same block", () => {
    const { editor, merged } = merge(1, "One\n\nTwo, outside\n\nThree\n\nFour\n");
    expect(merged).toBe(false);
    expect(texts(editor)).toEqual(["One", "Two!", "Three", "Four"]);
  });

  it("brings in outside changes on both sides of an edit", () => {
    const { editor, merged } = merge(2, "One, outside\n\nTwo\n\nThree\n\nFour, outside\n");
    expect(merged).toBe(true);
    expect(texts(editor)).toEqual(["One, outside", "Two", "Three!", "Four, outside"]);
  });

  it("brings in outside changes between edits", () => {
    const editor = createEditor(saved);
    const before = editor.children;
    edit(editor, 0, "!");
    edit(editor, 3, "?");
    editor.tf.insertNodes({ type: "p", children: [{ text: "Mine" }] }, { at: [2] });
    const next = mergeOutsideValue(
      editor,
      before,
      loadMarkdown(saved),
      loadMarkdown("One\n\nTwo, outside\n\nNew\n\nThree\n\nFour\n"),
    );
    expect(next).not.toBeNull();
    expect(texts(editor)).toEqual([
      "One!",
      "Two, outside",
      "New",
      "Mine",
      "Three",
      "Four?",
    ]);
    // The next merge compares with the saved text with the outside change in.
    expect(next!.map((node) => NodeApi.string(node))).toEqual([
      "One",
      "Two, outside",
      "New",
      "Three",
      "Four",
    ]);
  });

  it("brings in a change to the block next to an edit", () => {
    const { editor, merged } = merge(1, "One\n\nTwo\n\nThree, outside\n\nFour\n");
    expect(merged).toBe(true);
    expect(texts(editor)).toEqual(["One", "Two!", "Three, outside", "Four"]);
  });

  it("changes nothing when both added blocks at the same place", () => {
    const editor = createEditor(saved);
    const before = editor.children;
    editor.tf.insertNodes({ type: "p", children: [{ text: "Mine" }] }, { at: [2] });
    const next = mergeOutsideValue(
      editor,
      before,
      loadMarkdown(saved),
      loadMarkdown("One\n\nTwo\n\nTheirs\n\nThree\n\nFour\n"),
    );
    expect(next).toBeNull();
    expect(texts(editor)).toEqual(["One", "Two", "Mine", "Three", "Four"]);
  });

  it("keeps undo for the edits it kept", () => {
    const editor = createEditor(saved);
    const before = editor.children;
    edit(editor, 0, "!");
    mergeOutsideValue(
      editor,
      before,
      loadMarkdown(saved),
      loadMarkdown("One\n\nTwo, outside\n\nThree\n\nFour\n"),
    );
    editor.undo();
    expect(texts(editor)).toEqual(["One", "Two, outside", "Three", "Four"]);
  });
});

describe("reloadOpenShardIfChanged", () => {
  it("shows the new text of a shard changed outside the app", async () => {
    const editor = openNote("One\n\nTwo\n");
    vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo, outside\n");

    await reloadOpenShardIfChanged();

    expect(texts(editor)).toEqual(["One", "Two, outside"]);
    expect(store().markdownContent).toBe("One\n\nTwo, outside\n");
    expect(store().isDirty).toBe(false);
    // The change it made isn't an edit to save.
    expect(takeOutsideChange(editor)).toBe(true);
    expect(saveMarkdownFile).not.toHaveBeenCalled();
  });

  it("leaves the shard alone when the file holds what was saved", async () => {
    const editor = openNote("One\n");
    const before = editor.children;
    vi.mocked(readMarkdownFile).mockResolvedValue("One\n");

    await reloadOpenShardIfChanged();

    expect(editor.children).toBe(before);
    expect(takeOutsideChange(editor)).toBe(false);
  });

  it("merges an outside change into unsaved edits elsewhere", async () => {
    const editor = openNote("One\n\nTwo\n");
    edit(editor, 0, "!");
    vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo, outside\n");

    await reloadOpenShardIfChanged();

    expect(texts(editor)).toEqual(["One!", "Two, outside"]);
    expect(store().isDirty).toBe(true);
    expect(store().markdownContent).toBe("One\n\nTwo, outside\n");
    expect(saveMarkdownFile).not.toHaveBeenCalled();
  });

  describe("when the same part was edited", () => {
    async function conflict() {
      const editor = openNote("One\n\nTwo\n");
      edit(editor, 1, "!");
      vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo, outside\n");
      await reloadOpenShardIfChanged();
      return editor;
    }

    it("asks which version to keep and changes nothing until then", async () => {
      const editor = await conflict();

      expect(store().outsideChange).toEqual({
        path: NOTE,
        mine: "One\n\nTwo!\n",
        outside: "One\n\nTwo, outside\n",
      });
      expect(texts(editor)).toEqual(["One", "Two!"]);
      expect(store().isDirty).toBe(true);
      expect(store().markdownContent).toBe("One\n\nTwo\n");
      expect(saveMarkdownFile).not.toHaveBeenCalled();
    });

    it("keeps your version, to be saved over the outside one", async () => {
      const editor = await conflict();
      await keepVersion("mine");

      expect(texts(editor)).toEqual(["One", "Two!"]);
      expect(store().outsideChange).toBeNull();
      expect(store().isDirty).toBe(true);
      expect(store().markdownContent).toBe("One\n\nTwo, outside\n");
      expect(saveMarkdownFile).not.toHaveBeenCalled();
    });

    it("keeps the outside version", async () => {
      const editor = await conflict();
      await keepVersion("outside");

      expect(texts(editor)).toEqual(["One", "Two, outside"]);
      expect(store().outsideChange).toBeNull();
      expect(store().isDirty).toBe(false);
      expect(store().markdownContent).toBe("One\n\nTwo, outside\n");
    });

    it("keeps both, saving the outside version next to the shard", async () => {
      const editor = await conflict();
      vi.mocked(fileExists).mockImplementation(
        async (path) => path === "C:/vault/Note (Changed outside).md",
      );
      await keepVersion("both");

      expect(saveMarkdownFile).toHaveBeenCalledWith(
        "C:/vault/Note (Changed outside 2).md",
        "One\n\nTwo, outside\n",
      );
      expect(texts(editor)).toEqual(["One", "Two!"]);
      expect(store().isDirty).toBe(true);
      expect(store().markdownContent).toBe("One\n\nTwo, outside\n");
    });

    it("stops asking when the outside change is undone", async () => {
      await conflict();
      vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo\n");
      await reloadOpenShardIfChanged();
      expect(store().outsideChange).toBeNull();
    });
  });

  describe("after the app saved what you wrote", () => {
    /** Opens "One / Two" and saves "Two!" as autosave would. */
    function openAndSave() {
      const editor = openNote("One\n\nTwo\n");
      edit(editor, 1, "!");
      rememberSavedValue(editor, editor.children);
      store().markSaved("One\n\nTwo!\n");
      return editor;
    }

    it("asks when an outside save drops it", async () => {
      const editor = openAndSave();
      // An app that still had the old text saves it with its own change.
      vi.mocked(readMarkdownFile).mockResolvedValue("One, outside\n\nTwo\n");

      await reloadOpenShardIfChanged();

      expect(store().outsideChange).toEqual({
        path: NOTE,
        mine: "One\n\nTwo!\n",
        outside: "One, outside\n\nTwo\n",
      });
      expect(texts(editor)).toEqual(["One", "Two!"]);
    });

    it("asks when an outside save brings back what you deleted", async () => {
      const editor = openNote("One\n\nTwo\n");
      editor.tf.removeNodes({ at: [1] });
      rememberSavedValue(editor, editor.children);
      store().markSaved("One\n");
      vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo\n");

      await reloadOpenShardIfChanged();

      expect(store().outsideChange?.outside).toBe("One\n\nTwo\n");
      expect(texts(editor)).toEqual(["One"]);
    });

    it("shows an outside change that kept it", async () => {
      const editor = openAndSave();
      vi.mocked(readMarkdownFile).mockResolvedValue("One, outside\n\nTwo!\n");

      await reloadOpenShardIfChanged();

      expect(store().outsideChange).toBeNull();
      expect(texts(editor)).toEqual(["One, outside", "Two!"]);
    });

    it("saves your version again when you keep it", async () => {
      openAndSave();
      vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo\n");
      await reloadOpenShardIfChanged();
      await keepVersion("mine");

      expect(store().outsideChange).toBeNull();
      expect(store().isDirty).toBe(true);
      expect(store().markdownContent).toBe("One\n\nTwo\n");
    });

    it("stops counting it once an outside change is shown", async () => {
      const editor = openAndSave();
      vi.mocked(readMarkdownFile).mockResolvedValue("One, outside\n\nTwo!\n");
      await reloadOpenShardIfChanged();
      vi.mocked(readMarkdownFile).mockResolvedValue("One, outside\n\nTwo, again\n");
      await reloadOpenShardIfChanged();

      expect(store().outsideChange).toBeNull();
      expect(texts(editor)).toEqual(["One, outside", "Two, again"]);
    });
  });

  it("merges outside changes far from unsaved edits on both sides", async () => {
    const editor = openNote("One\n\nTwo\n\nThree\n");
    edit(editor, 1, "!");
    vi.mocked(readMarkdownFile).mockResolvedValue("Zero\n\nOne\n\nTwo\n\nThree, outside\n");

    await reloadOpenShardIfChanged();

    expect(store().outsideChange).toBeNull();
    expect(texts(editor)).toEqual(["Zero", "One", "Two!", "Three, outside"]);
    expect(store().isDirty).toBe(true);
  });

  it("merges a second outside change before the first merge is saved", async () => {
    const editor = openNote("One\n\nTwo\n\nThree\n");
    edit(editor, 1, "!");
    vi.mocked(readMarkdownFile).mockResolvedValue("One, outside\n\nTwo\n\nThree\n");
    await reloadOpenShardIfChanged();
    vi.mocked(readMarkdownFile).mockResolvedValue(
      "One, outside\n\nTwo\n\nThree, outside\n",
    );
    await reloadOpenShardIfChanged();

    expect(store().outsideChange).toBeNull();
    expect(texts(editor)).toEqual(["One, outside", "Two!", "Three, outside"]);
  });

  it("keeps undo after an outside change to a shard with no unsaved edits", async () => {
    const editor = openNote("One\n\nTwo\n");
    edit(editor, 0, "!");
    rememberSavedValue(editor, editor.children);
    store().markSaved("One!\n\nTwo\n");
    vi.mocked(readMarkdownFile).mockResolvedValue("One!\n\nTwo, outside\n");

    await reloadOpenShardIfChanged();
    editor.undo();

    expect(texts(editor)).toEqual(["One", "Two, outside"]);
  });

  it("doesn't ask when an outside save keeps edits saved in two places", async () => {
    const editor = openNote("One\n\nTwo\n\nThree\n\nFour\n");
    edit(editor, 0, "!");
    edit(editor, 3, "?");
    rememberSavedValue(editor, editor.children);
    store().markSaved("One!\n\nTwo\n\nThree\n\nFour?\n");
    vi.mocked(readMarkdownFile).mockResolvedValue(
      "One!\n\nTwo, outside\n\nThree\n\nFour?\n",
    );

    await reloadOpenShardIfChanged();

    expect(store().outsideChange).toBeNull();
    expect(texts(editor)).toEqual(["One!", "Two, outside", "Three", "Four?"]);
  });

  it("doesn't ask when both sides made the same change", async () => {
    const editor = openNote("One\n\nTwo\n");
    edit(editor, 1, "!");
    vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo!\n");

    await reloadOpenShardIfChanged();

    expect(store().outsideChange).toBeNull();
    expect(store().isDirty).toBe(false);
    expect(store().markdownContent).toBe("One\n\nTwo!\n");
    expect(texts(editor)).toEqual(["One", "Two!"]);
  });

  it("lets go of the cursor when its text changed outside", async () => {
    const editor = openNote("One\n\nTwo\n");
    editor.tf.select(editor.api.end([1])!);
    vi.mocked(readMarkdownFile).mockResolvedValue("One\n");

    await reloadOpenShardIfChanged();

    expect(texts(editor)).toEqual(["One"]);
    expect(editor.selection).toBeNull();
  });

  it("keeps the cursor when other text changed outside", async () => {
    const editor = openNote("One\n\nTwo\n");
    editor.tf.select(editor.api.end([0])!);
    vi.mocked(readMarkdownFile).mockResolvedValue("One\n\nTwo, outside\n");

    await reloadOpenShardIfChanged();

    expect(editor.selection).not.toBeNull();
  });

  it("waits for a shard still being prepared to show it", async () => {
    store().openFile({ path: NOTE, content: "One\n" });
    vi.mocked(readMarkdownFile).mockResolvedValue("One, outside\n");

    await reloadOpenShardIfChanged();
    const editor = createEditor("One\n");
    store().setPlateEditor(editor);
    await vi.waitFor(() => expect(texts(editor)).toEqual(["One, outside"]));
  });
});
