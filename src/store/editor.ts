import { create } from "zustand";

import type { Heading } from "@platejs/toc";
import type { Descendant, SlateEditor } from "platejs";

const EDITOR_STORE_LOG_PREFIX = "[Netherstone][Editor Store]";

function logEditorStoreLifecycle(
  event: string,
  details: Record<string, unknown>,
): void {
  console.info(EDITOR_STORE_LOG_PREFIX, event, details);
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface OpenEditorFilePayload {
  path: string;
  content: string;
  plateValue?: Descendant[] | null;
  cacheHit?: boolean;
}

interface EditorState {
  // ── Open File ──────────────────────────────────────────────────────────────
  currentFilePath: string | null;
  setCurrentFilePath: (path: string | null) => void;

  /**
   * The file being read from disk to open, if any. With nothing open yet,
   * the editor shows it's on its way instead of "No shard open", e.g. while
   * the last shard is reopened at launch.
   */
  openingFilePath: string | null;
  setOpeningFilePath: (path: string | null) => void;

  /**
   * Stable session key for the currently open editor document.
   * Changes when opening/closing a document, but not when renaming it.
   */
  editorSessionTick: number;

  /**
   * Monotonic edit counter for the current session.
   * Bump this on real document edits to drive autosave and other edit-driven effects
   * without depending on live markdown snapshot updates.
   */
  editTick: number;
  bumpEditTick: () => void;
  resetEditTick: () => void;

  // ── Content / Snapshots ────────────────────────────────────────────────────
  /** Source markdown loaded when the current file was opened. */
  content: string;
  /** Last saved or explicitly produced markdown snapshot; not the live editor source of truth. */
  markdownContent: string;
  /** Cached normalized Plate value for initializing the current open session. */
  initialValue: Descendant[] | null;
  /** Whether the current open session came from the AST cache path. */
  cacheHit: boolean;
  setContent: (content: string) => void;
  setMarkdownContent: (content: string) => void;

  /** Live Plate editor instance (set while a shard is open in `<Plate>`). */
  plateEditor: SlateEditor | null;
  setPlateEditor: (editor: SlateEditor | null) => void;

  /** Headings derived from the live editor (same source as `@platejs/toc`). */
  tocHeadings: Heading[];
  setTocHeadings: (headings: Heading[]) => void;

  // ── Dirty / Save State ─────────────────────────────────────────────────────
  /** Tracks unsaved editor changes independently from markdown snapshot updates. */
  isDirty: boolean;
  setIsDirty: (dirty: boolean) => void;

  isSaving: boolean;
  setIsSaving: (saving: boolean) => void;

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Call when a file is successfully saved — clears dirty/saving flags and can commit the saved markdown snapshot. */
  markSaved: (markdownContent?: string) => void;

  /** Open a new file: sets the path, replaces content, and carries optional cached AST state. */
  openFile: (payload: OpenEditorFilePayload) => void;

  /**
   * Update the currently open file path/content without starting a new editor session.
   * Used for operations like rename where the document is still the same editing session.
   */
  renameOpenFile: (path: string, content: string) => void;

  /** Close the current file and reset all editor state. */
  closeFile: () => void;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useEditorStore = create<EditorState>((set) => ({
  // ── Open File ──────────────────────────────────────────────────────────────
  currentFilePath: null,
  setCurrentFilePath: (path) => set({ currentFilePath: path }),

  openingFilePath: null,
  setOpeningFilePath: (path) => set({ openingFilePath: path }),

  editorSessionTick: 0,
  editTick: 0,
  bumpEditTick: () => set((state) => ({ editTick: state.editTick + 1 })),
  resetEditTick: () => set({ editTick: 0 }),

  // ── Content / Snapshots ────────────────────────────────────────────────────
  content: "",
  markdownContent: "",
  initialValue: null,
  cacheHit: false,
  setContent: (content) => set({ content }),
  setMarkdownContent: (markdownContent) => set({ markdownContent }),

  plateEditor: null,
  setPlateEditor: (editor) => set({ plateEditor: editor }),

  tocHeadings: [],
  setTocHeadings: (tocHeadings) => set({ tocHeadings }),

  // ── Dirty / Save State ─────────────────────────────────────────────────────
  isDirty: false,
  setIsDirty: (dirty) => set({ isDirty: dirty }),

  isSaving: false,
  setIsSaving: (saving) => set({ isSaving: saving }),

  // ── Helpers ────────────────────────────────────────────────────────────────
  markSaved: (markdownContent) =>
    set((state) => ({
      isDirty: false,
      isSaving: false,
      markdownContent: markdownContent ?? state.markdownContent,
    })),

  openFile: ({ path, content, plateValue = null, cacheHit = false }) =>
    set((state) => {
      const nextEditorSessionTick = state.editorSessionTick + 1;

      logEditorStoreLifecycle("openFile", {
        previousPath: state.currentFilePath,
        nextPath: path,
        previousEditorSessionTick: state.editorSessionTick,
        nextEditorSessionTick,
        cacheHit,
        hasInitialValue: plateValue !== null,
        markdownChars: content.length,
      });

      return {
        currentFilePath: path,
        editorSessionTick: nextEditorSessionTick,
        editTick: 0,
        content,
        markdownContent: content,
        initialValue: plateValue,
        cacheHit,
        isDirty: false,
        isSaving: false,
        // The previous note can stay on screen while this one prepares; it
        // must stop being the store's editor right away so saves, renames and
        // sidebars never pair its content with the new path.
        plateEditor: null,
        tocHeadings: [],
      };
    }),

  renameOpenFile: (path, content) =>
    set((state) => {
      logEditorStoreLifecycle("renameOpenFile", {
        previousPath: state.currentFilePath,
        nextPath: path,
        editorSessionTick: state.editorSessionTick,
        editTick: state.editTick,
        markdownChars: content.length,
      });

      return {
        currentFilePath: path,
        content,
        markdownContent: content,
        initialValue: state.initialValue,
        cacheHit: state.cacheHit,
      };
    }),

  closeFile: () =>
    set((state) => {
      const nextEditorSessionTick = state.editorSessionTick + 1;

      logEditorStoreLifecycle("closeFile", {
        previousPath: state.currentFilePath,
        previousEditorSessionTick: state.editorSessionTick,
        nextEditorSessionTick,
        previousEditTick: state.editTick,
        wasDirty: state.isDirty,
        wasSaving: state.isSaving,
        hadPlateEditor: state.plateEditor !== null,
        previousTocHeadingCount: state.tocHeadings.length,
      });

      return {
        currentFilePath: null,
        editorSessionTick: nextEditorSessionTick,
        editTick: 0,
        content: "",
        markdownContent: "",
        initialValue: null,
        cacheHit: false,
        isDirty: false,
        isSaving: false,
        plateEditor: null,
        tocHeadings: [],
      };
    }),
}));
