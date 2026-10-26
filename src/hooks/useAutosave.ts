import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEditorStore, useVaultStore } from "@/store";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import {
  finishDrawingSession,
  hasPendingDrawingSave,
} from "@/lib/drawing-files";
import {
  isChangedOnDiskError,
  reloadOpenShardIfChanged,
  rememberSavedValue,
} from "@/lib/outside-changes";
import { suppressVaultChangePath } from "@/lib/vault-change-suppression";

const AUTOSAVE_DELAY_MS = 1800;

type EditorStoreState = ReturnType<typeof useEditorStore.getState>;

let flushActiveAutosave: (() => Promise<void>) | null = null;

/**
 * The open shard's last saved text and the editor value it was saved from.
 * It goes into the editor cache when the shard is switched or closed, not
 * on every save: the cache only matters the next time the shard opens.
 * It keeps the vault it was saved in, so the write still lands after the
 * app moves on to another vault.
 */
let pendingCacheEntry: {
  vaultPath: string;
  filePath: string;
  markdown: string;
  plateValue: unknown;
} | null = null;

/** The cache writes still running, one after another. */
let cacheWrites: Promise<void> | null = null;

/**
 * Writes the open shard's last save to the editor cache. Leaving a shard
 * doesn't need to wait for it; quitting does.
 */
export function writeOpenShardCache(): Promise<void> {
  const entry = pendingCacheEntry;
  if (entry) {
    pendingCacheEntry = null;
    const write: Promise<void> = (cacheWrites ?? Promise.resolve())
      .then(() => upsertAstCache(entry))
      .catch((error) =>
        console.error(
          "[Netherstone] AST cache write failed:",
          entry.filePath,
          error,
        ),
      )
      .finally(() => {
        if (cacheWrites === write) cacheWrites = null;
      });
    cacheWrites = write;
  }
  return cacheWrites ?? Promise.resolve();
}

/**
 * Immediately persists any unsaved edits to the currently open file, waiting
 * for an in-flight save first. Call before replacing the open document.
 */
export async function flushPendingAutosave(): Promise<void> {
  await flushActiveAutosave?.();
}

/**
 * Debounced autosave hook for the editor.
 *
 * This version does not subscribe React to editor edits. Instead, it uses
 * imperative store subscriptions so `App` does not rerender on every change.
 *
 * - Saves 1800ms after the user stops typing
 * - Keeps only one trailing save while a write is in flight
 * - Flushes pending saves on window close
 * - Only saves when content is dirty
 */
export function useAutosave() {
  const timeoutRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const saveRequestedDuringFlightRef = useRef(false);
  const lastSavedFilePathRef = useRef<string | null>(null);
  const lastSavedContentRef = useRef("");
  const latestFilePathRef = useRef<EditorStoreState["currentFilePath"]>(
    useEditorStore.getState().currentFilePath,
  );
  const latestContentRef = useRef(useEditorStore.getState().markdownContent);
  const latestEditorRef = useRef(useEditorStore.getState().plateEditor);
  const latestDirtyRef = useRef(useEditorStore.getState().isDirty);
  const bypassCloseRequestRef = useRef(false);

  useEffect(() => {
    const syncRefsFromState = (state: EditorStoreState) => {
      latestFilePathRef.current = state.currentFilePath;
      latestContentRef.current = state.markdownContent;
      latestEditorRef.current = state.plateEditor;
      latestDirtyRef.current = state.isDirty;
    };

    const clearScheduledSave = () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };

    const setSaving = (saving: boolean) => {
      useEditorStore.getState().setIsSaving(saving);
    };

    const commitSavedState = (
      filePath: string,
      content: string,
      savedEditTick: number,
    ) => {
      const state = useEditorStore.getState();

      if (state.currentFilePath !== filePath) {
        return;
      }

      lastSavedFilePathRef.current = filePath;
      lastSavedContentRef.current = content;
      latestContentRef.current = content;

      // Edits made while saving aren't in `content`: the note stays dirty and
      // the save they scheduled writes them.
      if (state.editTick !== savedEditTick) {
        state.setMarkdownContent(content);
        return;
      }

      latestDirtyRef.current = false;
      state.markSaved(content);
    };

    /** `urgent`: something waits on this save, so it goes before any read. */
    const serializeCurrentMarkdown = async (urgent: boolean) => {
      const fallbackMarkdown = latestContentRef.current;
      const editor = latestEditorRef.current;
      const filePath = latestFilePathRef.current;

      if (!editor) {
        return fallbackMarkdown;
      }

      return serializeMarkdownInWorker(editor.children, {
        filePath,
        requestKey: filePath ? `autosave:${filePath}` : "autosave",
        urgent,
        fallback: () =>
          getSaveMarkdownContent(editor, fallbackMarkdown, { filePath }),
      });
    };

    const performSave = async (retryIfChanged = true, urgent = false) => {
      const filePath = latestFilePathRef.current;
      const dirty = latestDirtyRef.current;

      if (!filePath || !dirty) {
        return;
      }

      // Waits for the user to choose a version (OutsideChangeDialog).
      if (useEditorStore.getState().outsideChange?.path === filePath) {
        return;
      }

      // Slate values are immutable, so this is the exact value being saved.
      const editor = latestEditorRef.current;
      const savedValue = editor?.children;
      // The text the file held when it was opened or last saved.
      const expectedContent = useEditorStore.getState().markdownContent;
      const savedEditTick = useEditorStore.getState().editTick;
      const content = await serializeCurrentMarkdown(urgent);

      if (
        lastSavedFilePathRef.current === filePath &&
        lastSavedContentRef.current === content
      ) {
        const state = useEditorStore.getState();
        if (
          state.currentFilePath === filePath &&
          state.editTick === savedEditTick
        ) {
          latestDirtyRef.current = false;
          state.markSaved();
        }
        return;
      }

      inFlightRef.current = true;
      setSaving(true);
      let changedOnDisk = false;

      try {
        suppressVaultChangePath(filePath, { reason: "autosave" });

        await invoke("save_markdown_file", {
          filePath,
          content,
          // What you type counts toward the Overview page's writing.
          recordWriting: true,
          expectedContent,
        });

        const vaultPath = useVaultStore.getState().currentVaultPath;
        if (savedValue && vaultPath) {
          pendingCacheEntry = {
            vaultPath,
            filePath,
            markdown: content,
            plateValue: savedValue,
          };
        }

        if (editor && savedValue) rememberSavedValue(editor, savedValue);
        commitSavedState(filePath, content, savedEditTick);
      } catch (error) {
        changedOnDisk = retryIfChanged && isChangedOnDiskError(error);
        if (!changedOnDisk) console.error("Autosave failed:", error);
      } finally {
        inFlightRef.current = false;
        setSaving(false);
      }

      // Bring in what changed outside the app, then save the edits with it.
      if (changedOnDisk) {
        await reloadOpenShardIfChanged();
        await performSave(false, urgent);
        return;
      }

      if (saveRequestedDuringFlightRef.current) {
        saveRequestedDuringFlightRef.current = false;
        scheduleSave();
      }
    };

    const scheduleSave = () => {
      clearScheduledSave();

      if (!latestFilePathRef.current || !latestDirtyRef.current) {
        return;
      }

      timeoutRef.current = window.setTimeout(async () => {
        timeoutRef.current = null;

        if (inFlightRef.current) {
          saveRequestedDuringFlightRef.current = true;
          return;
        }

        await performSave();
      }, AUTOSAVE_DELAY_MS);
    };

    const flushNow = async () => {
      clearScheduledSave();

      while (inFlightRef.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }

      await performSave(true, true);
    };

    flushActiveAutosave = flushNow;
    syncRefsFromState(useEditorStore.getState());

    const unsubscribeStore = useEditorStore.subscribe(
      (state, previousState) => {
        syncRefsFromState(state);

        // Either is a new text on disk: another shard, or this one changed
        // outside the app or was saved elsewhere in the app.
        if (
          state.currentFilePath !== previousState.currentFilePath ||
          state.markdownContent !== previousState.markdownContent
        ) {
          lastSavedFilePathRef.current = state.currentFilePath;
          lastSavedContentRef.current = state.markdownContent;
        }

        const shouldReschedule =
          state.currentFilePath !== previousState.currentFilePath ||
          state.plateEditor !== previousState.plateEditor ||
          state.isDirty !== previousState.isDirty ||
          state.editTick !== previousState.editTick;

        if (shouldReschedule) {
          scheduleSave();
        }
      },
    );

    const appWindow = getCurrentWindow();
    const closeListenerPromise = appWindow.onCloseRequested(async (event) => {
      if (bypassCloseRequestRef.current) {
        bypassCloseRequestRef.current = false;
        return;
      }

      // Closing now would drop the edits; the choice is on screen.
      if (useEditorStore.getState().outsideChange) {
        event.preventDefault();
        return;
      }

      const hasPendingPersistenceWork =
        timeoutRef.current !== null ||
        inFlightRef.current ||
        !!(latestDirtyRef.current && latestFilePathRef.current) ||
        pendingCacheEntry !== null ||
        cacheWrites !== null ||
        hasPendingDrawingSave();

      if (!hasPendingPersistenceWork) {
        return;
      }

      event.preventDefault();

      try {
        await flushNow();
      } catch (error) {
        console.error("Failed to save on shutdown:", error);
      }
      await writeOpenShardCache();

      try {
        await finishDrawingSession();
      } catch (error) {
        console.error("Failed to save drawing on shutdown:", error);
      } finally {
        try {
          bypassCloseRequestRef.current = true;
          await appWindow.close();
        } catch {
          bypassCloseRequestRef.current = false;
        }
      }
    });

    return () => {
      clearScheduledSave();
      if (flushActiveAutosave === flushNow) {
        flushActiveAutosave = null;
      }
      unsubscribeStore();
      closeListenerPromise.then((unsubscribe) => unsubscribe());
    };
  }, []);
}
