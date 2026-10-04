import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEditorStore } from "@/store";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import {
  finishDrawingSession,
  hasPendingDrawingSave,
} from "@/lib/drawing-files";
import { suppressVaultChangePath } from "@/lib/vault-change-suppression";

const AUTOSAVE_DELAY_MS = 1800;
const SERIALIZATION_WORKER_TIMEOUT_MS = 5000;

type EditorStoreState = ReturnType<typeof useEditorStore.getState>;

let flushActiveAutosave: (() => Promise<void>) | null = null;

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

    const serializeCurrentMarkdown = async () => {
      const fallbackMarkdown = latestContentRef.current;
      const editor = latestEditorRef.current;
      const filePath = latestFilePathRef.current;

      if (!editor) {
        return fallbackMarkdown;
      }

      return serializeMarkdownInWorker(editor.children, {
        timeoutMs: SERIALIZATION_WORKER_TIMEOUT_MS,
        filePath,
        requestKey: filePath ? `autosave:${filePath}` : "autosave",
        fallback: () => getSaveMarkdownContent(editor, fallbackMarkdown),
      });
    };

    const performSave = async () => {
      const filePath = latestFilePathRef.current;
      const dirty = latestDirtyRef.current;

      if (!filePath || !dirty) {
        return;
      }

      // Slate values are immutable, so this is the exact value being saved.
      const savedValue = latestEditorRef.current?.children;
      const savedEditTick = useEditorStore.getState().editTick;
      const content = await serializeCurrentMarkdown();

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

      try {
        suppressVaultChangePath(filePath, { reason: "autosave" });

        await invoke("save_markdown_file", {
          filePath,
          content,
        });

        if (savedValue) {
          console.info(
            "[Netherstone] Autosave refreshing AST cache:",
            filePath,
          );

          try {
            await upsertAstCache({
              filePath,
              markdown: content,
              plateValue: savedValue,
            });

            console.info(
              "[Netherstone] Autosave AST cache refresh succeeded:",
              filePath,
            );
          } catch (error) {
            console.error(
              "[Netherstone] Autosave AST cache refresh failed:",
              filePath,
              error,
            );
          }
        }

        commitSavedState(filePath, content, savedEditTick);
      } catch (error) {
        console.error("Autosave failed:", error);
      } finally {
        inFlightRef.current = false;
        setSaving(false);
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

      await performSave();
    };

    flushActiveAutosave = flushNow;
    syncRefsFromState(useEditorStore.getState());

    const unsubscribeStore = useEditorStore.subscribe(
      (state, previousState) => {
        syncRefsFromState(state);

        if (state.currentFilePath !== previousState.currentFilePath) {
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

      const hasPendingPersistenceWork =
        timeoutRef.current !== null ||
        inFlightRef.current ||
        !!(latestDirtyRef.current && latestFilePathRef.current) ||
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
