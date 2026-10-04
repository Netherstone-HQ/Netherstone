import { useEditorStore } from "@/store/editor";

type PlateEditorLike =
  | {
      selection?: unknown;
    }
  | null
  | undefined;

export type OpenEditorSessionPathChangeSnapshot = {
  selection: unknown | null;
  scrollTop: number | null;
};

function cloneSelection(selection: unknown): unknown | null {
  if (selection == null) return null;

  try {
    return JSON.parse(JSON.stringify(selection));
  } catch {
    return selection;
  }
}

function getMainElement(): HTMLElement | null {
  const mainElement = document.querySelector("main");
  return mainElement instanceof HTMLElement ? mainElement : null;
}

export function captureOpenEditorSessionPathChangeSnapshot(
  editor?: PlateEditorLike,
): OpenEditorSessionPathChangeSnapshot {
  return {
    selection: cloneSelection(editor?.selection),
    scrollTop: getMainElement()?.scrollTop ?? null,
  };
}

export function restoreOpenEditorSessionAfterPathChange(
  snapshot: OpenEditorSessionPathChangeSnapshot,
): void {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const nextEditor = useEditorStore.getState().plateEditor as
        | {
            tf?: {
              select?: (selection: unknown) => void;
              focus?: () => void;
            };
          }
        | null
        | undefined;

      if (snapshot.selection && nextEditor?.tf?.select) {
        nextEditor.tf.select(snapshot.selection);
      }

      if (nextEditor?.tf?.focus) {
        nextEditor.tf.focus();
      }

      const mainElement = getMainElement();
      if (mainElement && snapshot.scrollTop !== null) {
        mainElement.scrollTop = snapshot.scrollTop;
      }
    });
  });
}

export function applyOpenEditorSessionPathChange(
  nextPath: string,
  content: string,
  snapshot: OpenEditorSessionPathChangeSnapshot,
): void {
  useEditorStore.getState().renameOpenFile(nextPath, content);
  restoreOpenEditorSessionAfterPathChange(snapshot);
}

export function preserveOpenEditorSessionPathChange(options: {
  nextPath: string;
  content: string;
  editor?: PlateEditorLike;
}): OpenEditorSessionPathChangeSnapshot {
  const snapshot = captureOpenEditorSessionPathChangeSnapshot(options.editor);
  applyOpenEditorSessionPathChange(options.nextPath, options.content, snapshot);
  return snapshot;
}
