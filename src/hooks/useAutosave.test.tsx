// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { createSlateEditor, type SlateEditor } from "platejs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SerializationKit } from "@/components/editor/serialization-kit";
import { openMarkdownFile, upsertAstCache } from "@/lib/editor-ast-cache";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore } from "@/store";
import { loadMarkdown } from "@/test/markdown";
import { useAutosave } from "./useAutosave";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

let closeRequestHandler: ((event: { preventDefault(): void }) => Promise<void>) | null;
const closeWindow = vi.fn(async () => {});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (handler: typeof closeRequestHandler) => {
      closeRequestHandler = handler;
      return () => {};
    },
    close: closeWindow,
  }),
}));

vi.mock("@/lib/editor-ast-cache", () => ({
  upsertAstCache: vi.fn(async () => {}),
  openMarkdownFile: vi.fn(),
}));

const AUTOSAVE_DELAY_MS = 1800;
const NOTE_A = "C:/vault/a.md";
const NOTE_B = "C:/vault/b.md";

const store = () => useEditorStore.getState();

/** The files written to disk, in order. */
function savedFiles() {
  return vi
    .mocked(invoke)
    .mock.calls.filter(([command]) => command === "save_markdown_file")
    .map(([, args]) => args as { filePath: string; content: string });
}

/**
 * Opens a note with an editor registered the way MountedEditor does it (the
 * mounted editor itself is covered by Editor.test.tsx).
 */
function openNote(filePath: string, markdown: string) {
  const editor = createSlateEditor({
    plugins: SerializationKit,
    value: loadMarkdown(markdown),
  });

  act(() => {
    store().openFile({ path: filePath, content: markdown });
    store().setPlateEditor(editor);
  });

  return editor;
}

/** Types at the end of the note, then reports it like MountedEditor's onChange. */
function type(editor: SlateEditor, text: string) {
  act(() => {
    editor.tf.select(editor.api.end([])!);
    editor.tf.insertText(text);
    store().setIsDirty(true);
    store().bumpEditTick();
  });
}

const wait = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockResolvedValue(null);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  closeRequestHandler = null;
  renderHook(() => useAutosave());
});

afterEach(() => {
  cleanup();
  act(() => store().closeFile());
  vi.useRealTimers();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("autosave", () => {
  it("never writes a note that wasn't edited", async () => {
    openNote(NOTE_A, "Hello\n");
    await wait(AUTOSAVE_DELAY_MS * 3);
    expect(savedFiles()).toEqual([]);
  });

  it("saves the edit once typing has paused", async () => {
    const editor = openNote(NOTE_A, "Hello\n");

    type(editor, " world");
    await wait(AUTOSAVE_DELAY_MS - 100);
    expect(savedFiles()).toEqual([]);

    await wait(100);
    expect(savedFiles()).toEqual([
      { filePath: NOTE_A, content: "Hello world\n" },
    ]);
    expect(store().isDirty).toBe(false);
    expect(store().markdownContent).toBe("Hello world\n");
  });

  it("restarts the delay on every edit and saves once", async () => {
    const editor = openNote(NOTE_A, "Hello\n");

    type(editor, " a");
    await wait(1000);
    type(editor, " b");
    await wait(1000);
    expect(savedFiles()).toEqual([]);

    await wait(AUTOSAVE_DELAY_MS);
    expect(savedFiles()).toEqual([{ filePath: NOTE_A, content: "Hello a b\n" }]);
  });

  it("refreshes the AST cache with what it saved", async () => {
    const editor = openNote(NOTE_A, "Hello\n");

    type(editor, "!");
    await wait(AUTOSAVE_DELAY_MS);

    expect(upsertAstCache).toHaveBeenCalledWith({
      filePath: NOTE_A,
      markdown: "Hello!\n",
      plateValue: editor.children,
    });
  });

  it("skips the write when the edit is undone before saving", async () => {
    const editor = openNote(NOTE_A, "Hello\n");

    type(editor, "!");
    act(() => editor.tf.deleteBackward("character"));
    await wait(AUTOSAVE_DELAY_MS);

    expect(savedFiles()).toEqual([]);
    expect(store().isDirty).toBe(false);
  });

  it("keeps the note dirty when the write fails, and saves on the next edit", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));

    type(editor, " world");
    await wait(AUTOSAVE_DELAY_MS);
    expect(savedFiles()).toHaveLength(1);
    expect(store().isDirty).toBe(true);

    type(editor, "!");
    await wait(AUTOSAVE_DELAY_MS);
    expect(savedFiles().at(-1)).toEqual({
      filePath: NOTE_A,
      content: "Hello world!\n",
    });
    expect(store().isDirty).toBe(false);
  });

  it("saves edits made while a write is in flight", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    let finishWrite = () => {};
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((resolve) => (finishWrite = () => resolve(null))),
    );

    type(editor, " one");
    await wait(AUTOSAVE_DELAY_MS);
    type(editor, " two");
    await wait(AUTOSAVE_DELAY_MS);
    expect(savedFiles()).toHaveLength(1);

    await act(async () => finishWrite());
    await wait(AUTOSAVE_DELAY_MS);

    expect(savedFiles().at(-1)).toEqual({
      filePath: NOTE_A,
      content: "Hello one two\n",
    });
    expect(store().isDirty).toBe(false);
  });

  it("keeps an edit made during a write dirty until it's saved", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    let finishWrite = () => {};
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((resolve) => (finishWrite = () => resolve(null))),
    );

    type(editor, " one");
    await wait(AUTOSAVE_DELAY_MS);
    type(editor, " two");
    await act(async () => finishWrite());

    // The first write finished, but " two" isn't on disk yet.
    expect(store().isDirty).toBe(true);

    await wait(AUTOSAVE_DELAY_MS);
    expect(savedFiles().at(-1)).toEqual({
      filePath: NOTE_A,
      content: "Hello one two\n",
    });
    expect(store().isDirty).toBe(false);
  });

  it("caches the value it wrote, not edits made during the write", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    let finishWrite = () => {};
    vi.mocked(invoke).mockImplementationOnce(
      () => new Promise((resolve) => (finishWrite = () => resolve(null))),
    );

    type(editor, " one");
    await wait(AUTOSAVE_DELAY_MS);
    const savedValue = editor.children;
    type(editor, " two");
    await act(async () => finishWrite());

    expect(upsertAstCache).toHaveBeenCalledWith({
      filePath: NOTE_A,
      markdown: "Hello one\n",
      plateValue: savedValue,
    });
  });

  it("saves pending edits before the window closes", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    type(editor, " world");

    const preventDefault = vi.fn();
    await act(() => closeRequestHandler!({ preventDefault }));

    expect(preventDefault).toHaveBeenCalled();
    expect(savedFiles()).toEqual([
      { filePath: NOTE_A, content: "Hello world\n" },
    ]);
    expect(closeWindow).toHaveBeenCalled();
  });

  it("lets the window close right away with nothing to save", async () => {
    openNote(NOTE_A, "Hello\n");

    const preventDefault = vi.fn();
    await act(() => closeRequestHandler!({ preventDefault }));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(savedFiles()).toEqual([]);
  });
});

describe("switching notes", () => {
  beforeEach(() => {
    vi.mocked(openMarkdownFile).mockImplementation(async (filePath) => ({
      filePath,
      markdown: `Note ${filePath}\n`,
      contentHash: "hash",
      cacheHit: false,
      plateValue: null,
    }));
  });

  it("saves the current note's edits before opening the next one", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    type(editor, " world");

    await act(() => openEditorFile(NOTE_B));

    expect(savedFiles()).toEqual([
      { filePath: NOTE_A, content: "Hello world\n" },
    ]);
    expect(store().currentFilePath).toBe(NOTE_B);
    expect(store().content).toBe(`Note ${NOTE_B}\n`);
  });

  it("stays on the current note when its edits can't be saved", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    type(editor, " world");
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));

    await act(() =>
      expect(openEditorFile(NOTE_B)).rejects.toThrow(/could not be saved/),
    );

    expect(openMarkdownFile).not.toHaveBeenCalled();
    expect(store().currentFilePath).toBe(NOTE_A);
    expect(store().isDirty).toBe(true);
    expect(store().plateEditor).toBe(editor);
  });

  it("never saves one note's content under another note's path", async () => {
    const editor = openNote(NOTE_A, "Hello\n");
    type(editor, " world");

    await act(() => openEditorFile(NOTE_B));
    await wait(AUTOSAVE_DELAY_MS * 3);

    expect(savedFiles()).toEqual([
      { filePath: NOTE_A, content: "Hello world\n" },
    ]);
  });
});
