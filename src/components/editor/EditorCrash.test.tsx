// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { openMarkdownFile } from "@/lib/editor-ast-cache";
import { useEditorStore } from "@/store";
import { Editor } from "./Editor";

// Stand-in for the real editor that crashes until `crash` is turned off.
const editorState = vi.hoisted(() => ({ crash: true }));

vi.mock("./MountedEditor", () => ({
  MountedEditor: ({ content }: { content: string }) => {
    if (editorState.crash) throw new Error("Cannot read properties of undefined");
    return <p>{content}</p>;
  },
}));

vi.mock("@/lib/editor-ast-cache", () => ({
  openMarkdownFile: vi.fn(async (filePath: string) => ({
    filePath,
    markdown: "Saved on disk",
    contentHash: "hash",
    cacheHit: false,
    plateValue: [],
  })),
}));

const NOTE_PATH = "C:/vault/note.md";

afterEach(() => {
  cleanup();
  act(() => useEditorStore.getState().closeFile());
  vi.restoreAllMocks();
});

it("shows the error in place of the editor and reloads the note from disk", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});

  act(() => {
    useEditorStore
      .getState()
      .openFile({ path: NOTE_PATH, content: "Unsaved", plateValue: [] });
  });
  render(<Editor />);

  expect(await screen.findByText("The editor ran into an error.")).toBeTruthy();
  expect(screen.getByText("Cannot read properties of undefined")).toBeTruthy();

  // The crashed editor's edits are gone; reloading must not try to save them.
  act(() => useEditorStore.getState().setIsDirty(true));
  editorState.crash = false;
  fireEvent.click(screen.getByRole("button", { name: "Reload note" }));

  expect(await screen.findByText("Saved on disk")).toBeTruthy();
  expect(openMarkdownFile).toHaveBeenCalledWith(NOTE_PATH);
  expect(useEditorStore.getState().isDirty).toBe(false);
});
