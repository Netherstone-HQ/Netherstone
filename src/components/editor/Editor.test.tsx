// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SlateEditor } from "platejs";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { TooltipProvider } from "@/components/ui/tooltip";
import { openMarkdownFile, upsertAstCache } from "@/lib/editor-ast-cache";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore, useVaultStore } from "@/store";
import { Editor } from "./Editor";

// The AST cache lives in the Tauri backend.
vi.mock("@/lib/editor-ast-cache", () => ({
  upsertAstCache: vi.fn(async () => {}),
  openMarkdownFile: vi.fn(async (filePath: string) => ({
    filePath,
    markdown: "Linked note\n",
    contentHash: "hash",
    cacheHit: false,
    plateValue: null,
  })),
}));

const NOTE_PATH = "C:/vault/notes/note.md";

const NOTE = [
  "# Weekly notes",
  "",
  "Some **bold** and _italic_ text.",
  "",
  "- first item",
  "- second item",
  "",
  "```ts",
  "const a = <T>(x: { y: 1 }) => x < 2;",
  "```",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "Last paragraph.",
  "",
].join("\n");

/** Saves the open note the way autosave does (worker, else main thread). */
function save(editor: SlateEditor) {
  return serializeMarkdownInWorker(editor.children, {
    filePath: NOTE_PATH,
    fallback: () => getSaveMarkdownContent(editor, ""),
  });
}

function renderEditor() {
  // The same providers App wraps the editor in.
  render(
    <DndProvider backend={HTML5Backend}>
      <TooltipProvider>
        <Editor />
      </TooltipProvider>
    </DndProvider>,
  );
}

/** Opens a note and waits until its editor is mounted and registered. */
async function openNote(content: string, plateValue: any[] | null = null) {
  act(() => {
    useEditorStore
      .getState()
      .openFile({ path: NOTE_PATH, content, plateValue, cacheHit: !!plateValue });
  });
  renderEditor();

  const editor = await waitFor(() => {
    const mounted = useEditorStore.getState().plateEditor;
    expect(mounted).not.toBeNull();
    return mounted as SlateEditor;
  });

  // Let the mount frames pass; from then on changes count as user edits.
  await act(() => new Promise((resolve) => setTimeout(resolve, 50)));

  return editor;
}

/** Places the cursor at the end of the top-level block at `index`. */
function selectEndOf(editor: SlateEditor, index: number) {
  editor.tf.select(editor.api.end([index])!);
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  act(() => useEditorStore.getState().closeFile());
  vi.restoreAllMocks();
  vi.mocked(upsertAstCache).mockClear();
  vi.mocked(openMarkdownFile).mockClear();
});

describe("Editor", () => {
  describe("while a shard opens with nothing open yet", () => {
    // At launch the last shard is reopened this way. Showing "No shard open"
    // until it arrived read as a flash of the welcome tour.
    it("shows the loading bar, not the empty state", async () => {
      let finishRead: () => void = () => {};
      vi.mocked(openMarkdownFile).mockImplementationOnce(
        (filePath) =>
          new Promise((resolve) => {
            finishRead = () =>
              resolve({
                filePath,
                markdown: NOTE,
                contentHash: "hash",
                cacheHit: false,
                plateValue: null,
              });
          }),
      );
      renderEditor();
      expect(screen.getByText("No shard open")).toBeTruthy();

      let opening: Promise<unknown> = Promise.resolve();
      act(() => {
        opening = openEditorFile(NOTE_PATH);
      });
      expect(screen.queryByText("No shard open")).toBeNull();
      expect(
        await screen.findByLabelText("Loading document", {}, { timeout: 1000 }),
      ).toBeTruthy();

      await act(async () => {
        finishRead();
        await opening;
      });
      expect(
        await screen.findByRole("heading", { name: "Weekly notes" }),
      ).toBeTruthy();
      expect(useEditorStore.getState().openingFilePath).toBeNull();
    });

    it("goes back to the empty state if the shard can't be read", async () => {
      vi.mocked(openMarkdownFile).mockRejectedValueOnce(new Error("gone"));
      renderEditor();

      await act(async () => {
        await expect(openEditorFile(NOTE_PATH)).rejects.toThrow("gone");
      });
      expect(useEditorStore.getState().openingFilePath).toBeNull();
      expect(screen.getByText("No shard open")).toBeTruthy();
    });
  });

  it("loads a note and shows its content", async () => {
    await openNote(NOTE);

    expect(
      screen.getByRole("heading", { name: "Weekly notes" }),
    ).toBeTruthy();
    expect(screen.getByText("second item")).toBeTruthy();
    expect(screen.getByText("Last paragraph.")).toBeTruthy();
  });

  it("does not mark a note dirty just for opening it", async () => {
    await openNote(NOTE);
    expect(useEditorStore.getState().isDirty).toBe(false);
  });

  it("saves an unedited note unchanged", async () => {
    const editor = await openNote(NOTE);
    expect(await save(editor)).toBe(NOTE);
  });

  it("marks the note dirty on an edit and saves it with nothing else lost", async () => {
    const editor = await openNote(NOTE);
    const lastIndex = editor.children.length - 1;

    await act(async () => {
      selectEndOf(editor, lastIndex);
      editor.tf.insertText(" Added later.");
    });

    expect(useEditorStore.getState().isDirty).toBe(true);
    expect(await save(editor)).toBe(
      NOTE.replace("Last paragraph.", "Last paragraph. Added later."),
    );
  });

  it("saves new blocks, formatting and deletions", async () => {
    const editor = await openNote(NOTE);

    await act(async () => {
      // New paragraph after the heading.
      selectEndOf(editor, 0);
      editor.tf.insertBreak();
      editor.tf.insertText("Inserted line.");

      // Bold the last word of the last paragraph.
      const lastIndex = editor.children.length - 1;
      const end = editor.api.end([lastIndex])!;
      editor.tf.select({
        anchor: { path: end.path, offset: end.offset - "paragraph.".length },
        focus: end,
      });
      editor.tf.toggleMark("bold");

      // Remove the second list item.
      const secondItem = editor.children.findIndex((node: any) =>
        editor.api.string([editor.children.indexOf(node)]).includes("second item"),
      );
      editor.tf.removeNodes({ at: [secondItem] });
    });

    expect(await save(editor)).toBe(
      NOTE.replace("# Weekly notes\n", "# Weekly notes\n\nInserted line.\n")
        .replace("- second item\n", "")
        .replace("Last paragraph.", "Last **paragraph.**"),
    );
  });

  it("reopens a saved note with the same content", async () => {
    const editor = await openNote(NOTE);
    await act(async () => {
      selectEndOf(editor, 0);
      editor.tf.insertText(" (edited)");
    });
    const saved = await save(editor);
    cleanup();

    const reopened = await openNote(saved);
    expect(await save(reopened)).toBe(saved);
    expect(screen.getByRole("heading", { name: "Weekly notes (edited)" })).toBeTruthy();
  });

  it("opens from the cached AST and saves the same markdown", async () => {
    await openNote(NOTE);
    const [[{ markdown, plateValue }]] = vi.mocked(upsertAstCache).mock.calls;
    expect(markdown).toBe(NOTE);
    const cachedValue = structuredClone(plateValue as any[]);
    cleanup();

    const fromCache = await openNote(NOTE, cachedValue);
    expect(await save(fromCache)).toBe(NOTE);
  });

  describe("links", () => {
    const LINKS = [
      "[Sibling](./other.md)",
      "[Parent](../up.md)",
      "[Site](https://example.com)",
      "[Anchor](#weekly-notes)",
    ].join(" and ");

    const click = (name: string) => {
      const link = screen.getByText(name).closest("a")!;
      fireEvent.click(link);
    };

    it("opens a linked note relative to the current one", async () => {
      await openNote(`${LINKS}\n`);

      click("Sibling");
      await waitFor(() =>
        expect(openMarkdownFile).toHaveBeenCalledWith("C:/vault/notes/other.md"),
      );
      await waitFor(() =>
        expect(useEditorStore.getState().currentFilePath).toBe(
          "C:/vault/notes/other.md",
        ),
      );
    });

    it("resolves .. against the note's folder", async () => {
      await openNote(`${LINKS}\n`);

      click("Parent");
      await waitFor(() =>
        expect(openMarkdownFile).toHaveBeenCalledWith("C:/vault/up.md"),
      );
    });

    it("opens a mentioned note", async () => {
      act(() =>
        useVaultStore.getState().setFileTree([
          {
            name: "notes",
            path: "C:/vault/notes",
            kind: "directory",
            children: [
              { name: "Other.md", path: "C:/vault/notes/Other.md", kind: "file" },
            ],
          },
        ]),
      );
      await openNote("See [Other](mention:Other) here.\n");

      fireEvent.click(screen.getByText("Other"));
      await waitFor(() =>
        expect(openMarkdownFile).toHaveBeenCalledWith("C:/vault/notes/Other.md"),
      );
      act(() => useVaultStore.getState().setFileTree([]));
    });

    it("never gives a javascript: link an href", async () => {
      await openNote("[Bad](javascript:alert(1))\n");
      expect(screen.getByText("Bad").closest("a")!.hasAttribute("href")).toBe(
        false,
      );
    });

    it("leaves web links and in-page anchors to the browser", async () => {
      await openNote(`${LINKS}\n`);

      click("Site");
      click("Anchor");
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(openMarkdownFile).not.toHaveBeenCalled();
      expect(useEditorStore.getState().currentFilePath).toBe(NOTE_PATH);
    });
  });
});
