// @vitest-environment jsdom
import {
  act,
  cleanup,
  createEvent,
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
import { readMarkdownFile } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { reloadOpenShardIfChanged } from "@/lib/outside-changes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
import { useSettingsStore } from "@/store/settings";
import { Editor } from "./Editor";

vi.mock("@tauri-apps/plugin-opener", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tauri-apps/plugin-opener")>()),
  openUrl: vi.fn(async () => {}),
}));

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

vi.mock("@/lib/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/commands")>()),
  readMarkdownFile: vi.fn(),
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

/** Index of the top-level block whose text includes `text`. */
function blockIndexOf(editor: SlateEditor, text: string) {
  return editor.children.findIndex((_, index) =>
    editor.api.string([index]).includes(text),
  );
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

  describe("closing or switching away from a long shard", () => {
    // Removing a long shard takes a while, so what comes next is shown first.
    it("shows the empty state at once and removes the shard after", async () => {
      await openNote(NOTE);
      act(() => useEditorStore.getState().closeFile());

      expect(screen.getByText("No shard open")).toBeTruthy();
      const closed = document.querySelector("[data-slate-editor]");
      expect(closed?.closest("[hidden]")).not.toBeNull();

      await waitFor(() =>
        expect(document.querySelector("[data-slate-editor]")).toBeNull(),
      );
    });

    it("keeps the next shard's editor when the previous one is removed", async () => {
      await openNote(NOTE);
      act(() => {
        useEditorStore.getState().openFile({
          path: "C:/vault/notes/other.md",
          content: "Other shard\n",
        });
      });

      const next = await waitFor(() => {
        const mounted = useEditorStore.getState().plateEditor;
        expect(mounted?.api.string([0])).toBe("Other shard");
        return mounted;
      });
      await waitFor(() =>
        expect(document.querySelectorAll("[data-slate-editor]")).toHaveLength(1),
      );

      expect(useEditorStore.getState().plateEditor).toBe(next);
    });
  });

  it("shows a change made outside the app in place, without marking it dirty", async () => {
    const editor = await openNote(NOTE);
    const heading = editor.children[0];
    const changed = NOTE.replace("Last paragraph.", "Changed elsewhere.");
    vi.mocked(readMarkdownFile).mockResolvedValue(changed);

    await act(() => reloadOpenShardIfChanged());

    expect(screen.getByText("Changed elsewhere.")).toBeTruthy();
    expect(useEditorStore.getState().plateEditor).toBe(editor);
    expect(editor.children[0]).toBe(heading);
    expect(useEditorStore.getState().isDirty).toBe(false);
    expect(useEditorStore.getState().markdownContent).toBe(changed);
    expect(await save(editor)).toBe(changed);

    // Typing afterwards is an edit as usual.
    await act(async () => {
      selectEndOf(editor, blockIndexOf(editor, "Changed elsewhere."));
      editor.tf.insertText("!");
    });
    expect(useEditorStore.getState().isDirty).toBe(true);
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

    await act(async () => {
      selectEndOf(editor, blockIndexOf(editor, "Last paragraph."));
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
      const end = editor.api.end([blockIndexOf(editor, "Last paragraph.")])!;
      editor.tf.select({
        anchor: { path: end.path, offset: end.offset - "paragraph.".length },
        focus: end,
      });
      editor.tf.toggleMark("bold");

      // Remove the second list item.
      editor.tf.removeNodes({ at: [blockIndexOf(editor, "second item")] });
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

  describe("the empty line at the end", () => {
    const isBlankLine = (node: any) =>
      node.type === "p" && !node.listStyleType && node.children[0].text === "";

    it("ends every shard and never reaches the file", async () => {
      const editor = await openNote(NOTE);

      expect(isBlankLine(editor.children.at(-1))).toBe(true);
      expect(editor.api.string([editor.children.length - 2])).toBe(
        "Last paragraph.",
      );
      expect(await save(editor)).toBe(NOTE);
    });

    it("moves down once something is typed into it", async () => {
      const editor = await openNote(NOTE);
      const lineIndex = editor.children.length - 1;

      await act(async () => {
        selectEndOf(editor, lineIndex);
        editor.tf.insertText("New line.");
      });

      expect(editor.api.string([lineIndex])).toBe("New line.");
      expect(editor.children).toHaveLength(lineIndex + 2);
      expect(isBlankLine(editor.children.at(-1))).toBe(true);
      expect(await save(editor)).toBe(`${NOTE}\nNew line.\n`);
    });

    // Ctrl+A selects every block, and Delete removes them all at once. With
    // no block left, the shard had nowhere to type until it was reopened.
    it("is still there to type into after every block is deleted", async () => {
      const editor = await openNote(NOTE);

      await act(async () => {
        editor.tf.withoutNormalizing(() => {
          for (let index = editor.children.length - 1; index >= 0; index -= 1) {
            editor.tf.removeNodes({ at: [index] });
          }
        });
      });

      expect(editor.children).toHaveLength(1);
      expect(isBlankLine(editor.children[0])).toBe(true);
      expect(await save(editor)).toBe("");

      await act(async () => {
        selectEndOf(editor, 0);
        editor.tf.insertText("Fresh start.");
      });

      expect(await save(editor)).toBe("Fresh start.\n");
    });
  });

  describe("links", () => {
    const LINKS = [
      "[Sibling](./other.md)",
      "[Parent](../up.md)",
      "[Site](https://example.com/docs)",
      "[Anchor](#weekly-notes)",
    ].join(" and ");

    // A link to another shard shows as an @ chip, not an anchor.
    const click = (name: string) => {
      fireEvent.click(screen.getByText(name));
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

    it.each([
      ["percent-encoded", "./Netherstone%20roadmap.md"],
      ["in angle brackets", "<./Netherstone roadmap.md>"],
    ])("opens a linked note with a space in its name, %s", async (_, url) => {
      await openNote(`[Roadmap](${url})\n`);

      click("Roadmap");
      await waitFor(() =>
        expect(openMarkdownFile).toHaveBeenCalledWith(
          "C:/vault/notes/Netherstone roadmap.md",
        ),
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

    describe("web links", () => {
      beforeEach(() =>
        useUIStore.setState({
          isBrowserPanelOpen: false,
          browserLastUrl: null,
          browserUrlRequest: null,
        }),
      );
      afterEach(() => vi.mocked(openUrl).mockClear());

      const ctrlClick = (name: string) => {
        fireEvent.click(screen.getByText(name), { ctrlKey: true });
      };

      it("leaves a web link to edit on a plain click", async () => {
        await openNote(`${LINKS}\n`);

        const event = createEvent.click(screen.getByText("Site"));
        fireEvent(screen.getByText("Site"), event);
        await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

        expect(event.defaultPrevented).toBe(true);
        expect(useUIStore.getState().isBrowserPanelOpen).toBe(false);
        expect(openUrl).not.toHaveBeenCalled();
      });

      it("opens a web link in the browser panel with Ctrl", async () => {
        await openNote(`${LINKS}\n`);

        ctrlClick("Site");

        await waitFor(() =>
          expect(useUIStore.getState().isBrowserPanelOpen).toBe(true),
        );
        expect(useUIStore.getState().browserLastUrl).toBe(
          "https://example.com/docs",
        );
        expect(openUrl).not.toHaveBeenCalled();
        expect(useEditorStore.getState().currentFilePath).toBe(NOTE_PATH);
      });

      it("sends a web link to the open panel", async () => {
        act(() => useUIStore.setState({ isBrowserPanelOpen: true }));
        await openNote(`${LINKS}\n`);

        ctrlClick("Site");

        await waitFor(() =>
          expect(useUIStore.getState().browserUrlRequest).toBe(
            "https://example.com/docs",
          ),
        );
      });

      it("opens a web link in your browser when Settings says so", async () => {
        act(() => useSettingsStore.setState({ openLinksIn: "your-browser" }));
        await openNote(`${LINKS}\n`);

        ctrlClick("Site");

        await waitFor(() =>
          expect(openUrl).toHaveBeenCalledWith("https://example.com/docs"),
        );
        expect(useUIStore.getState().isBrowserPanelOpen).toBe(false);
        act(() => useSettingsStore.setState({ openLinksIn: "browser-panel" }));
      });
    });

    it("leaves in-page anchors alone", async () => {
      await openNote(`${LINKS}\n`);

      click("Anchor");
      await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

      expect(openMarkdownFile).not.toHaveBeenCalled();
      expect(useUIStore.getState().browserUrlRequest).toBeNull();
      expect(useEditorStore.getState().currentFilePath).toBe(NOTE_PATH);
    });
  });
});
