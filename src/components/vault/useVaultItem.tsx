import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowDownUpIcon,
  FilePlusIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  HistoryIcon,
  ImagePlusIcon,
  ImportIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  ShareIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AddToShardDialog,
  hasSomethingToAdd,
} from "@/components/canvas/AddToShardDialog";
import { DrawingIcon } from "@/components/icons";
import { MoveFileDialog } from "@/components/vault/MoveFileDialog";
import { NewShardDialog } from "@/components/vault/NewShardDialog";
import type { RowAction } from "@/components/vault/RowActions";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import {
  readDrawingScene,
  relinkDrawingReferences,
  type ExportableScene,
} from "@/lib/drawing-exports";
import {
  flushPendingDrawingSave,
  getVaultFileDisplayName,
  isDrawingPath,
  isPathWithin,
  isSamePath,
  remapPathAfterMove,
} from "@/lib/drawing-files";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { openExportDialog } from "@/lib/export";
import { openImportDialog } from "@/lib/import";
import {
  applyOpenEditorSessionPathChange,
  captureOpenEditorSessionPathChangeSnapshot,
} from "@/lib/open-editor-session-path-change";
import {
  createDrawing,
  openFileHistory,
  openVaultFile,
} from "@/lib/open-vault-file";
import { refreshVault } from "@/lib/refresh-vault";
import { remapShardLinkKeys } from "@/lib/shard-link-keys";
import { saveVaultVersion } from "@/lib/sync";
import { suppressVaultChangePaths } from "@/lib/vault-change-suppression";
import {
  useEditorStore,
  useSettingsStore,
  useUIStore,
  useVaultStore,
} from "@/store";
import type { FileTreeNode } from "@/store";

export function getDisplayName(node: FileTreeNode) {
  return node.kind === "file" ? getVaultFileDisplayName(node.name) : node.name;
}

/**
 * Saves the open drawing if `path` is it or contains it, so a rename, move or
 * delete never races its autosave.
 */
async function flushDrawingAffectedBy(path: string) {
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
function suppressPathChange(
  node: FileTreeNode,
  newPath: string | null,
  reason: "rename" | "move",
) {
  const oldPaths = collectTreePaths(node);
  const newPaths = newPath
    ? oldPaths.map(
        (path) => remapPathAfterMove(path, node.path, newPath) ?? path,
      )
    : [];
  suppressVaultChangePaths([...oldPaths, ...newPaths], { reason });
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

export type VaultItemOptions = {
  onNewFolder?: () => void;
  /** Adds Close, for the open file. */
  onClose?: () => void;
  /** Actions before the file's own, such as New drawing. */
  leadingActions?: RowAction[];
  /** Takes the place of Export…, for files that export differently. */
  exportActions?: RowAction[];
};

/**
 * Everything a file or folder row can do, shared by the file tree, the
 * Pinned section and the top bars: its action list (for the "more" button and
 * the right-click menu), inline renaming, and the dialogs those actions open.
 */
export function useVaultItem(
  node: FileTreeNode,
  {
    onNewFolder,
    onClose,
    leadingActions = [],
    exportActions,
  }: VaultItemOptions = {},
) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(getDisplayName(node));
  const [isMoving, setIsMoving] = useState(false);
  const [isConfirmingTrash, setIsConfirmingTrash] = useState(false);
  const [isCreatingShard, setIsCreatingShard] = useState(false);
  // The drawing's scene, read when Add to shard… is picked, for its dialog.
  const [sceneToAdd, setSceneToAdd] = useState<ExportableScene | null>(null);
  const [isAddingToShard, setIsAddingToShard] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  // Enter commits the rename, and the input then loses focus (the editor
  // takes it back, or the row remounts under its new path), which commits
  // again. The second call would rename a path that no longer exists.
  const isRenameSubmittingRef = useRef(false);

  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const markdownContent = useEditorStore((s) => s.markdownContent);
  const plateEditor = useEditorStore((s) => s.plateEditor);
  const markSaved = useEditorStore((s) => s.markSaved);
  const closeFile = useEditorStore((s) => s.closeFile);
  const remapRememberedPaths = useUIStore((s) => s.remapRememberedPaths);
  const forgetRememberedPaths = useUIStore((s) => s.forgetRememberedPaths);
  const togglePinnedFile = useUIStore((s) => s.togglePinnedFile);
  const isPinned = useUIStore((s) =>
    s.pinnedFiles.some((entry) => isSamePath(entry.path, node.path)),
  );
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);
  const setNewFolderParent = useVaultStore((s) => s.setNewFolderParent);

  const displayName = getDisplayName(node);

  const open = async () => {
    if (node.kind !== "file") return;

    try {
      await openVaultFile(node.path);
    } catch (error) {
      console.error("Failed to load file:", error);
    }
  };

  const startRename = () => {
    setNewName(displayName);
    setIsRenaming(true);
  };

  useEffect(() => {
    if (!isRenaming) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [isRenaming]);

  const cancelRename = () => {
    setIsRenaming(false);
    setNewName(getDisplayName(node));
  };

  /** Saves the open shard if it is `node` or inside it, before its path changes. */
  const persistOpenFileBeforePathChange = async (
    reason: "rename" | "move",
  ): Promise<{
    path: string;
    content: string;
    sessionSnapshot: ReturnType<
      typeof captureOpenEditorSessionPathChangeSnapshot
    >;
  } | null> => {
    if (!currentFilePath || !isPathWithin(currentFilePath, node.path)) {
      return null;
    }

    const sessionSnapshot =
      captureOpenEditorSessionPathChangeSnapshot(plateEditor);

    const content = plateEditor
      ? await serializeMarkdownInWorker(plateEditor.children, {
          timeoutMs: 5000,
          filePath: currentFilePath,
          requestKey: `${reason}:${currentFilePath}`,
          fallback: () =>
            getSaveMarkdownContent(plateEditor, markdownContent, {
              filePath: currentFilePath,
            }),
        })
      : markdownContent;

    suppressVaultChangePaths([currentFilePath], {
      reason,
    });

    await invoke("save_markdown_file", {
      filePath: currentFilePath,
      content,
    });

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
  };

  /**
   * Points everything that remembers a path at `newPath` once `node` has
   * been renamed or moved: the open shard (even deep inside a folder), the
   * open drawing, recent and pinned files, and drawing links.
   */
  const finishPathChange = async (
    newPath: string,
    persistedOpenFile: Awaited<
      ReturnType<typeof persistOpenFileBeforePathChange>
    >,
    reason: "rename" | "move",
  ) => {
    remapActiveDrawingPath(node.path, newPath);
    suppressPathChange(node, newPath, reason);

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
      saveVaultVersion(currentVaultPath).catch((error) =>
        console.error(`[Netherstone] Couldn't save a version after ${reason}:`, error),
      );
    }
  };

  const handleRename = async () => {
    if (isRenameSubmittingRef.current) return;

    const trimmedName = newName.trim();

    if (!trimmedName || trimmedName === displayName) {
      cancelRename();
      return;
    }

    isRenameSubmittingRef.current = true;

    try {
      const persistedOpenFile = await persistOpenFileBeforePathChange("rename");
      await flushDrawingAffectedBy(node.path);
      suppressPathChange(node, null, "rename");

      const newPath = await invoke<string>("rename_file", {
        oldPath: node.path,
        newName: trimmedName,
      });

      await finishPathChange(newPath, persistedOpenFile, "rename");
      cancelRename();
    } catch (error) {
      console.error("Failed to rename:", error);
      alert(error instanceof Error ? error.message : String(error));
      cancelRename();
    } finally {
      isRenameSubmittingRef.current = false;
    }
  };

  const handleDelete = async () => {
    const deletesOpenFile =
      !!currentFilePath && isPathWithin(currentFilePath, node.path);

    try {
      await flushDrawingAffectedBy(node.path);
      // Let a save that is already running finish first, so it can't write
      // the shard back after it has gone to the trash.
      if (deletesOpenFile) await flushPendingAutosave();

      await invoke("delete_vault_path", {
        targetPath: node.path,
      });

      const { activeDrawingPath, openDrawing } = useUIStore.getState();
      if (activeDrawingPath && isPathWithin(activeDrawingPath, node.path)) {
        openDrawing(null);
      }

      forgetRememberedPaths(node.path);

      if (deletesOpenFile) {
        closeFile();
      }

      await refreshVault(currentVaultPath);
    } catch (error) {
      console.error("Failed to delete:", error);
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const handleOpenFileLocation = async () => {
    try {
      await revealItemInDir(node.path);
    } catch (error) {
      console.error("Failed to open file location:", error);
      alert(error instanceof Error ? error.message : String(error));
    }
  };

  const moveToFolder = async (destinationPath: string) => {
    try {
      const persistedOpenFile = await persistOpenFileBeforePathChange("move");
      await flushDrawingAffectedBy(node.path);
      suppressPathChange(node, null, "move");

      const newPath = await invoke<string>("move_file", {
        sourcePath: node.path,
        destinationDir: destinationPath,
      });

      await finishPathChange(newPath, persistedOpenFile, "move");
    } catch (error) {
      console.error("Failed to move:", error);
      alert(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const handleTrash = () => {
    if (useSettingsStore.getState().confirmBeforeDelete) {
      setIsConfirmingTrash(true);
    } else {
      void handleDelete();
    }
  };

  const handleNewFolder = () => {
    onNewFolder?.();
    setNewFolderParent(node.path);
  };

  const startAddingToShard = async () => {
    try {
      // The drawing may be open in Canvas with changes not saved yet.
      await flushDrawingAffectedBy(node.path);
      const scene = await readDrawingScene(node.path);
      if (hasSomethingToAdd(scene)) {
        setSceneToAdd(scene);
        setIsAddingToShard(true);
      }
    } catch (error) {
      console.error("[Netherstone] Failed to read drawing:", error);
      toast.error(`Couldn't open ${displayName}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const shared: RowAction[] = [
    { label: "Rename", icon: PencilIcon, onSelect: startRename },
    { label: "Move", icon: ArrowDownUpIcon, onSelect: () => setIsMoving(true) },
    {
      label: "Open location",
      icon: FolderOpenIcon,
      onSelect: () => void handleOpenFileLocation(),
    },
  ];
  const trash: RowAction = {
    label: "Move to trash",
    icon: Trash2Icon,
    onSelect: handleTrash,
    destructive: true,
    separated: true,
  };

  const actions: RowAction[] =
    node.kind === "directory"
      ? [
          {
            label: "New shard",
            icon: FilePlusIcon,
            onSelect: () => setIsCreatingShard(true),
          },
          {
            label: "New drawing",
            icon: DrawingIcon,
            onSelect: () => {
              if (currentVaultPath) {
                void createDrawing(currentVaultPath, node.path);
              }
            },
          },
          {
            label: "New folder",
            icon: FolderPlusIcon,
            onSelect: handleNewFolder,
          },
          {
            label: "Import here",
            icon: ImportIcon,
            onSelect: () => openImportDialog(node.path),
          },
          { ...shared[0], separated: true },
          ...shared.slice(1),
          trash,
        ]
      : [
          ...leadingActions,
          {
            label: isPinned ? "Unpin" : "Pin",
            icon: isPinned ? PinOffIcon : PinIcon,
            onSelect: () =>
              togglePinnedFile({ path: node.path, name: node.name }),
            separated: leadingActions.length > 0,
          },
          {
            label: "Show history",
            icon: HistoryIcon,
            onSelect: () =>
              void openFileHistory(node.path).catch((error) =>
                console.error("[Netherstone] Couldn't show history:", error),
              ),
          },
          { ...shared[0], separated: true },
          ...shared.slice(1),
          ...(exportActions ??
            (isDrawingPath(node.path)
              ? [
                  {
                    label: "Add to shard",
                    icon: ImagePlusIcon,
                    onSelect: () => void startAddingToShard(),
                  },
                ]
              : [
                  {
                    label: "Export",
                    icon: ShareIcon,
                    onSelect: () => openExportDialog(node.path),
                  },
                ])),
          ...(onClose
            ? [
                {
                  label: "Close",
                  icon: XIcon,
                  onSelect: onClose,
                  separated: true,
                },
                { ...trash, separated: false },
              ]
            : [trash]),
        ];

  const renameInputProps = {
    ref: inputRef,
    value: newName,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setNewName(e.target.value),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelRename();
      }
    },
    onBlur: () => void handleRename(),
  };

  const dialogs = (
    <>
      <AlertDialog open={isConfirmingTrash} onOpenChange={setIsConfirmingTrash}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>Move “{displayName}” to trash?</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void handleDelete()}
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {node.kind === "directory" ? (
        <NewShardDialog
          open={isCreatingShard}
          onOpenChange={setIsCreatingShard}
          folder={node.path}
        />
      ) : null}
      {sceneToAdd ? (
        <AddToShardDialog
          open={isAddingToShard}
          onOpenChange={setIsAddingToShard}
          drawingPath={node.path}
          getScene={() => sceneToAdd}
        />
      ) : null}
      <MoveFileDialog
        open={isMoving}
        onOpenChange={setIsMoving}
        fileName={displayName}
        filePath={node.path}
        isFolder={node.kind === "directory"}
        currentVaultPath={currentVaultPath}
        fileTree={fileTree}
        onMove={moveToFolder}
      />
    </>
  );

  return {
    displayName,
    actions,
    open,
    isRenaming,
    renameInputProps,
    moveToFolder,
    dialogs,
  };
}
