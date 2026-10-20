import type { Descendant } from "platejs";
import { toast } from "sonner";
import { resolveSessionValue } from "@/components/editor/lib/session-value";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { fileExists, saveDrawingFile, saveMarkdownFile } from "@/lib/commands";
import {
  finishDrawingSession,
  getVaultFileDisplayName,
  isDrawingPath,
} from "@/lib/drawing-files";
import {
  parseDrawing,
  refreshLinkedDrawingImages,
} from "@/lib/drawing-exports";
import { formatVersionMoment, restoreVersion } from "@/lib/history";
import { openEditorFile } from "@/lib/open-editor-file";
import {
  isChangedOnDiskError,
  rememberSavedValue,
  showOutsideValue,
} from "@/lib/outside-changes";
import { suppressVaultChangePath } from "@/lib/vault-change-suppression";
import { useEditorStore } from "@/store/editor";
import { type HistoryPlace, useHistoryStore } from "@/store/history";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";

type Version = { blob: string; time: number };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Puts `version` back in the open shard or drawing and shows it as it is
 * now. A toast offers Undo, which brings back the version saved just before.
 */
export async function restoreFileVersion(version: Version) {
  const place = useHistoryStore.getState().openIn ?? "notes";
  const filePath = openFilePath(place);
  if (!filePath) return;
  const restored = await restore(version, place, filePath);
  if (!restored) return;
  const { undo } = restored;
  toast.success(`Restored ${formatVersionMoment(version.time)}`, {
    action: undo
      ? { label: "Undo", onClick: () => void restore(undo, place, filePath) }
      : undefined,
  });
}

function openFilePath(place: HistoryPlace) {
  return place === "canvas"
    ? useUIStore.getState().activeDrawingPath
    : useEditorStore.getState().currentFilePath;
}

async function restore(
  version: Version,
  place: HistoryPlace,
  filePath: string,
) {
  const vaultPath = useVaultStore.getState().currentVaultPath;
  if (!vaultPath) return null;
  // Undo after another file was opened: that file isn't the one to change.
  if (openFilePath(place) !== filePath) {
    toast.error("Couldn't undo the restore", {
      description: "That file isn't open any more.",
    });
    return null;
  }

  try {
    const result =
      place === "canvas"
        ? await restoreDrawing(vaultPath, filePath, version)
        : await restoreShard(vaultPath, filePath, version);
    if (!result) return null;
    const history = useHistoryStore.getState();
    history.pickVersion(null);
    history.versionsChanged();
    return result;
  } catch (error) {
    console.error("[Netherstone] Couldn't restore a version:", error);
    toast.error("Couldn't restore this version", {
      description: isChangedOnDiskError(error)
        ? "The shard just changed outside the app. Try again."
        : errorText(error),
    });
    return null;
  }
}

async function restoreShard(
  vaultPath: string,
  filePath: string,
  version: Version,
) {
  await flushPendingAutosave();
  const state = useEditorStore.getState();
  if (state.currentFilePath !== filePath) return null;
  if (state.isDirty || state.outsideChange) {
    toast.error("Couldn't restore this version", {
      description:
        "Your latest changes aren't saved yet. Try again in a moment.",
    });
    return null;
  }

  // Outside-change checks wait while this is set, then find the restored
  // text already on screen.
  state.setIsSaving(true);
  try {
    suppressVaultChangePath(filePath, { reason: "restore" });
    const result = await restoreVersion(
      vaultPath,
      filePath,
      version,
      state.markdownContent,
    );
    await showRestoredText(filePath, result.content);
    return result;
  } finally {
    useEditorStore.getState().setIsSaving(false);
  }
}

/** Shows `markdown`, just written to the open shard, keeping the scroll position. */
async function showRestoredText(filePath: string, markdown: string) {
  const editor = useEditorStore.getState().plateEditor;
  const value = (await resolveSessionValue(
    filePath,
    markdown,
    null,
  )) as Descendant[];
  const state = useEditorStore.getState();
  if (
    !editor ||
    state.plateEditor !== editor ||
    state.currentFilePath !== filePath
  ) {
    await openEditorFile(filePath);
    return;
  }
  showOutsideValue(editor, value);
  rememberSavedValue(editor, editor.children);
  state.setMarkdownContent(markdown);
  void upsertAstCache({ filePath, markdown, plateValue: value }).catch(
    (error) => console.error("[Netherstone] AST cache refresh failed:", error),
  );
}

async function restoreDrawing(
  vaultPath: string,
  filePath: string,
  version: Version,
) {
  await finishDrawingSession();

  suppressVaultChangePath(filePath, { reason: "restore" });
  const result = await restoreVersion(vaultPath, filePath, version);
  // A new session, so the canvas loads the restored drawing.
  useUIStore.getState().openDrawing(filePath);

  void parseDrawing(result.content)
    .then((scene) => refreshLinkedDrawingImages(filePath, vaultPath, scene))
    .catch((error) =>
      console.error(
        "[Netherstone] Couldn't update the drawing in shards:",
        error,
      ),
    );
  return result;
}

/** `Note.md` → `Note (Earlier version).md`, numbered if that name is taken. */
async function freeVersionCopyPath(filePath: string) {
  const match = /^(.*?)(\.[^./\\]+)$/.exec(filePath);
  const [base, extension] = match ? [match[1], match[2]] : [filePath, ""];
  for (let n = 1; ; n += 1) {
    const label = n === 1 ? "Earlier version" : `Earlier version ${n}`;
    const path = `${base} (${label})${extension}`;
    if (!(await fileExists(path))) return path;
  }
}

/** Saves `content`, an earlier version of `filePath`, as a new file beside it. */
export async function saveVersionCopy(filePath: string, content: string) {
  try {
    const path = await freeVersionCopyPath(filePath);
    if (isDrawingPath(filePath)) await saveDrawingFile(path, content);
    else await saveMarkdownFile(path, content);
    toast.success(
      `Saved ${getVaultFileDisplayName(path.split(/[\\/]/).pop() ?? path)}`,
    );
  } catch (error) {
    console.error("[Netherstone] Couldn't save a copy of a version:", error);
    toast.error("Couldn't save a copy", { description: errorText(error) });
  }
}
