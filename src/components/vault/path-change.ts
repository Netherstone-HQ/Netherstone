// Renaming or moving a vault item: the open shard is saved first, and
// everything that remembers a path follows it to the new one after.

import { relinkDrawingReferences } from "@/lib/drawing-exports";
import {
  flushPendingDrawingSave,
  isDrawingPath,
  isPathWithin,
  remapPathAfterMove,
} from "@/lib/drawing-files";
import { saveMarkdownFile } from "@/lib/commands/shards";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import {
  applyOpenEditorSessionPathChange,
  captureOpenEditorSessionPathChangeSnapshot,
} from "@/lib/open-editor-session-path-change";
import { refreshVault } from "@/lib/refresh-vault";
import { remapShardLinkKeys } from "@/lib/shard-link-keys";
import { saveVaultVersion } from "@/lib/sync";
import { suppressVaultChangePaths } from "@/lib/vault-change-suppression";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";
import { useHistoryStore } from "@/store/history";

type EditorState = ReturnType<typeof useEditorStore.getState>;

/** The open editor, as the row saw it when the change started. */
type OpenEditor = Pick<
  EditorState,
  "currentFilePath" | "markdownContent" | "plateEditor" | "markSaved"
>;

/** What else follows the new path. */
type Followers = Pick<EditorState, "plateEditor"> &
  Pick<ReturnType<typeof useUIStore.getState>, "remapRememberedPaths"> &
  Pick<ReturnType<typeof useVaultStore.getState>, "currentVaultPath">;

type PathChangeReason = "rename" | "move";

/**
 * Saves the open drawing if `path` is it or contains it, so a rename, move or
 * delete never races its autosave.
 */
export async function flushDrawingAffectedBy(path: string) {
  const { activeDrawingPath } = useUIStore.getState();

  if (activeDrawingPath && isPathWithin(activeDrawingPath, path)) {
    await flushPendingDrawingSave();
  }
}

/** `node`'s path and every path inside it, as the watcher reports them. */
function collectTreePaths(node: FileTreeNode): string[] {
  return [node.path, ...(node.children ?? []).flatMap(collectTreePaths)];
}

/**
 * Keeps the watcher from treating a rename or move the app just made as an
 * outside change, for `node` and everything inside it at both paths.
 */
export function suppressPathChange(node: FileTreeNode, newPath: string | null) {
  const oldPaths = collectTreePaths(node);
  const newPaths = newPath
    ? oldPaths.map(
        (path) => remapPathAfterMove(path, node.path, newPath) ?? path,
      )
    : [];
  suppressVaultChangePaths([...oldPaths, ...newPaths]);
}

function remapActiveDrawingPath(oldPath: string, newPath: string) {
  const { activeDrawingPath, setActiveDrawingPath } = useUIStore.getState();
  if (!activeDrawingPath) return;

  const remapped = remapPathAfterMove(activeDrawingPath, oldPath, newPath);
  if (remapped) {
    setActiveDrawingPath(remapped);
  }
}

/**
 * Keeps images exported from drawings linked after a drawing, or a folder
 * that may contain drawings, is renamed or moved.
 */
async function relinkMovedDrawings(
  node: FileTreeNode,
  newPath: string,
  currentVaultPath: string | null,
) {
  if (!currentVaultPath) return;
  if (node.kind === "file" && !isDrawingPath(node.path)) return;

  try {
    await relinkDrawingReferences(node.path, newPath, currentVaultPath);
  } catch (error) {
    console.error("[Netherstone] Failed to relink drawing exports:", error);
  }
}

/** Saves the open shard if it is `node` or inside it, before its path changes. */
export async function persistOpenFileBeforePathChange(
  node: FileTreeNode,
  reason: PathChangeReason,
  { currentFilePath, markdownContent, plateEditor, markSaved }: OpenEditor,
): Promise<{
  path: string;
  content: string;
  sessionSnapshot: ReturnType<
    typeof captureOpenEditorSessionPathChangeSnapshot
  >;
} | null> {
  if (!currentFilePath || !isPathWithin(currentFilePath, node.path)) {
    return null;
  }

  const sessionSnapshot =
    captureOpenEditorSessionPathChangeSnapshot(plateEditor);

  const content = plateEditor
    ? await serializeMarkdownInWorker(plateEditor.children, {
        filePath: currentFilePath,
        requestKey: `${reason}:${currentFilePath}`,
        urgent: true,
        fallback: () =>
          getSaveMarkdownContent(plateEditor, markdownContent, {
            filePath: currentFilePath,
          }),
      })
    : markdownContent;

  suppressVaultChangePaths([currentFilePath]);

  await saveMarkdownFile(currentFilePath, content);

  if (plateEditor) {
    try {
      await upsertAstCache({
        filePath: currentFilePath,
        markdown: content,
        plateValue: plateEditor.children,
      });
    } catch (error) {
      console.error(
        `[Netherstone] Failed to refresh AST cache before ${reason}:`,
        currentFilePath,
        error,
      );
    }
  }

  markSaved(content);

  return {
    path: currentFilePath,
    content,
    sessionSnapshot,
  };
}

/**
 * Points everything that remembers a path at `newPath` once `node` has
 * been renamed or moved: the open shard (even deep inside a folder), the
 * open drawing, recent and pinned files, and drawing links.
 */
export async function finishPathChange(
  node: FileTreeNode,
  newPath: string,
  persistedOpenFile: Awaited<
    ReturnType<typeof persistOpenFileBeforePathChange>
  >,
  reason: PathChangeReason,
  { plateEditor, remapRememberedPaths, currentVaultPath }: Followers,
) {
  useHistoryStore.getState().setPathChangeTarget(newPath);
  remapActiveDrawingPath(node.path, newPath);
  suppressPathChange(node, newPath);

  const openPath = persistedOpenFile
    ? remapPathAfterMove(persistedOpenFile.path, node.path, newPath)
    : null;

  if (persistedOpenFile && openPath) {
    if (plateEditor) {
      try {
        await upsertAstCache({
          filePath: openPath,
          markdown: persistedOpenFile.content,
          plateValue: plateEditor.children,
        });
      } catch (error) {
        console.error(
          `[Netherstone] Failed to refresh AST cache after ${reason}:`,
          openPath,
          error,
        );
      }
    }

    applyOpenEditorSessionPathChange(
      openPath,
      persistedOpenFile.content,
      persistedOpenFile.sessionSnapshot,
    );
  }

  remapRememberedPaths(node.path, newPath);

  // The files on disk already point at the new paths; the open editor's
  // @ links follow, so its next save agrees with them.
  if (plateEditor) {
    remapShardLinkKeys(plateEditor, node.path, newPath);
  }

  await refreshVault(currentVaultPath);
  await relinkMovedDrawings(node, newPath, currentVaultPath);

  // Saved now, so the history follows the new name at once.
  if (currentVaultPath) {
    saveVaultVersion(currentVaultPath)
      .catch((error) =>
        console.error(`[Netherstone] Couldn't save a version after ${reason}:`, error),
      )
      .finally(useHistoryStore.getState().endPathChange);
  } else {
    useHistoryStore.getState().endPathChange();
  }
}
