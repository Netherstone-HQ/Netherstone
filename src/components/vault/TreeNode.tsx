import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  ArrowsDownUpIcon,
  CaretRightIcon,
  DotsThreeVerticalIcon,
  FolderOpenIcon,
  PencilSimpleIcon,
  ScribbleIcon,
  TrashIcon,
} from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";

import {
  flushPendingDrawingSave,
  getVaultFileDisplayName,
  isDrawingPath,
  isPathWithin,
  remapPathAfterMove,
} from "@/lib/drawing-files";
import { relinkDrawingReferences } from "@/lib/drawing-exports";
import { openVaultFile } from "@/lib/open-vault-file";
import {
  applyOpenEditorSessionPathChange,
  captureOpenEditorSessionPathChangeSnapshot,
} from "@/lib/open-editor-session-path-change";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { cn } from "@/lib/utils";
import {
  useEditorStore,
  useSettingsStore,
  useUIStore,
  useVaultStore,
} from "@/store";
import type { FileTreeNode } from "@/store";

import { MoveFileDialog } from "@/components/vault/MoveFileDialog";
import { suppressVaultChangePaths } from "@/lib/vault-change-suppression";

const MAX_INDENT_DEPTH = 6;
const INDENT_STEP_PX = 16;
const BASE_INDENT_PX = 6;
const DISCLOSURE_SLOT_PX = 16;
const FILE_DISCLOSURE_SLOT_PX = 12;
const ACTION_SLOT_PX = 20;

function getGuideLeft(depth: number) {
  return BASE_INDENT_PX + depth * INDENT_STEP_PX + DISCLOSURE_SLOT_PX / 2;
}

function getAncestorGuideDepths(depth: number) {
  return Array.from(
    { length: Math.min(depth, MAX_INDENT_DEPTH) },
    (_, index) => index,
  );
}

function getDisplayName(node: FileTreeNode) {
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

async function refreshVault(currentVaultPath: string | null) {
  if (!currentVaultPath) return;

  const fileTree = await invoke<FileTreeNode[]>("scan_vault", {
    vaultPath: currentVaultPath,
  });

  useVaultStore.getState().setFileTree(fileTree);
  await invoke("index_vault", { vaultPath: currentVaultPath });
}

type TreeNodeProps = {
  node: FileTreeNode;
  depth?: number;
};

export function TreeNode({ node, depth = 0 }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(getDisplayName(node));
  const [isHovered, setIsHovered] = useState(false);
  const [isMoving, setIsMoving] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isConfirmingTrash, setIsConfirmingTrash] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const markdownContent = useEditorStore((s) => s.markdownContent);
  const plateEditor = useEditorStore((s) => s.plateEditor);
  const markSaved = useEditorStore((s) => s.markSaved);
  const closeFile = useEditorStore((s) => s.closeFile);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);
  const updateRecentFilePath = useUIStore((s) => s.updateRecentFilePath);
  const removeRecentFile = useUIStore((s) => s.removeRecentFile);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);

  const displayName = getDisplayName(node);

  const handleDropdownOpenChange = (open: boolean) => {
    setIsDropdownOpen(open);
    if (!open) {
      setIsHovered(false);
    }
  };

  const handleFileClick = async () => {
    if (node.kind !== "file") return;

    try {
      await openVaultFile(node.path);
      setActiveNavItem(null);
    } catch (error) {
      console.error("Failed to load file:", error);
    }
  };

  const startRename = () => {
    setNewName(displayName);
    setIsRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setNewName(getDisplayName(node));
  };

  const persistOpenFileBeforePathChange = async (
    reason: "rename" | "move",
  ): Promise<{
    content: string;
    sessionSnapshot: ReturnType<
      typeof captureOpenEditorSessionPathChangeSnapshot
    >;
  } | null> => {
    if (
      node.kind !== "file" ||
      node.path !== currentFilePath ||
      !currentFilePath
    ) {
      return null;
    }

    const sessionSnapshot =
      captureOpenEditorSessionPathChangeSnapshot(plateEditor);

    const content = plateEditor
      ? await serializeMarkdownInWorker(plateEditor.children, {
          timeoutMs: 5000,
          filePath: currentFilePath,
          requestKey: `${reason}:${currentFilePath}`,
          fallback: () => getSaveMarkdownContent(plateEditor, markdownContent),
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
      content,
      sessionSnapshot,
    };
  };

  const handleRename = async () => {
    const trimmedName = newName.trim();

    if (!trimmedName || trimmedName === displayName) {
      cancelRename();
      return;
    }

    try {
      const persistedOpenFile = await persistOpenFileBeforePathChange("rename");
      await flushDrawingAffectedBy(node.path);

      suppressVaultChangePaths([node.path], {
        reason: "rename",
      });

      const newPath = await invoke<string>("rename_file", {
        oldPath: node.path,
        newName: trimmedName,
      });

      remapActiveDrawingPath(node.path, newPath);

      suppressVaultChangePaths([node.path, newPath], {
        reason: "rename",
      });

      if (persistedOpenFile) {
        if (plateEditor) {
          try {
            await upsertAstCache({
              filePath: newPath,
              markdown: persistedOpenFile.content,
              plateValue: plateEditor.children,
            });
          } catch (error) {
            console.error(
              "[Netherstone] Failed to refresh AST cache after rename:",
              newPath,
              error,
            );
          }
        }

        applyOpenEditorSessionPathChange(
          newPath,
          persistedOpenFile.content,
          persistedOpenFile.sessionSnapshot,
        );
      }

      if (node.kind === "file") {
        updateRecentFilePath(node.path, newPath);
      }

      await refreshVault(currentVaultPath);
      await relinkMovedDrawings(node, newPath, currentVaultPath);
      cancelRename();
    } catch (error) {
      console.error("Failed to rename:", error);
      alert(error instanceof Error ? error.message : String(error));
      cancelRename();
    }
  };

  const handleDelete = async () => {
    try {
      await flushDrawingAffectedBy(node.path);

      await invoke("delete_vault_path", {
        targetPath: node.path,
      });

      const { activeDrawingPath, openDrawing } = useUIStore.getState();
      if (activeDrawingPath && isPathWithin(activeDrawingPath, node.path)) {
        openDrawing(null);
      }

      if (node.kind === "file") {
        removeRecentFile(node.path);
      }

      if (node.kind === "file" && node.path === currentFilePath) {
        closeFile();
      }

      if (
        node.kind === "directory" &&
        currentFilePath &&
        (currentFilePath === node.path ||
          currentFilePath.startsWith(`${node.path}\\`) ||
          currentFilePath.startsWith(`${node.path}/`))
      ) {
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

  const handleMove = () => {
    if (node.kind !== "file") return;

    setIsMoving(true);
  };

  const handleMoveToFolder = async (destinationPath: string) => {
    if (node.kind !== "file") return;

    try {
      const persistedOpenFile = await persistOpenFileBeforePathChange("move");
      await flushDrawingAffectedBy(node.path);

      suppressVaultChangePaths([node.path], {
        reason: "move",
      });

      const newPath = await invoke<string>("move_file", {
        sourcePath: node.path,
        destinationDir: destinationPath,
      });

      remapActiveDrawingPath(node.path, newPath);

      suppressVaultChangePaths([node.path, newPath], {
        reason: "move",
      });

      if (persistedOpenFile) {
        if (plateEditor) {
          try {
            await upsertAstCache({
              filePath: newPath,
              markdown: persistedOpenFile.content,
              plateValue: plateEditor.children,
            });
          } catch (error) {
            console.error(
              "[Netherstone] Failed to refresh AST cache after move:",
              newPath,
              error,
            );
          }
        }

        applyOpenEditorSessionPathChange(
          newPath,
          persistedOpenFile.content,
          persistedOpenFile.sessionSnapshot,
        );
      }

      updateRecentFilePath(node.path, newPath);

      await refreshVault(currentVaultPath);
      await relinkMovedDrawings(node, newPath, currentVaultPath);
    } catch (error) {
      console.error("Failed to move:", error);
      alert(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  };

  const rowIndent = BASE_INDENT_PX + depth * INDENT_STEP_PX;
  const childIndent = BASE_INDENT_PX + (depth + 1) * INDENT_STEP_PX;
  const guideDepths = getAncestorGuideDepths(depth);
  const showChildrenGuide =
    node.kind === "directory" && depth < MAX_INDENT_DEPTH;

  const rowGuides = guideDepths.map((guideDepth) => (
    <div
      key={`${node.path}-guide-${guideDepth}`}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border/40"
      style={{ left: `${getGuideLeft(guideDepth)}px` }}
    />
  ));

  const rowContent = (
    <div
      className={cn(
        "flex h-7 w-full min-w-0 items-center gap-1 rounded-sm pr-1 text-sm transition-colors hover:bg-accent/70",
        node.kind === "file" &&
          node.path === currentFilePath &&
          "bg-accent text-accent-foreground hover:bg-accent",
      )}
      style={{ paddingLeft: `${rowIndent}px` }}
    >
      {node.kind === "directory" ? (
        isRenaming ? (
          <div className="flex min-w-0 flex-1 items-center gap-1 px-0 py-0 text-left font-normal">
            <span
              aria-hidden="true"
              className="flex h-4 shrink-0 items-center justify-center"
              style={{ width: `${DISCLOSURE_SLOT_PX}px` }}
            >
              <CaretRightIcon
                className={cn(
                  "h-3.5 w-3.5 text-sidebar-foreground/70 transition-transform duration-150",
                  isOpen && "rotate-90",
                )}
              />
            </span>
            <Input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => void handleRename()}
              className="h-6 min-w-0 flex-1 px-2 py-0 text-sm"
            />
          </div>
        ) : (
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-w-0 flex-1 justify-start gap-1 px-0 py-0 text-left font-normal"
            >
              <span
                aria-hidden="true"
                className="flex h-4 shrink-0 items-center justify-center"
                style={{ width: `${DISCLOSURE_SLOT_PX}px` }}
              >
                <CaretRightIcon
                  className={cn(
                    "h-3.5 w-3.5 text-sidebar-foreground/70 transition-transform duration-150",
                    isOpen && "rotate-90",
                  )}
                />
              </span>
              <span className="block min-w-0 flex-1 truncate">{node.name}</span>
            </Button>
          </CollapsibleTrigger>
        )
      ) : isRenaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-left">
          <span
            aria-hidden="true"
            className="shrink-0"
            style={{ width: `${FILE_DISCLOSURE_SLOT_PX}px` }}
          />
          <Input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void handleRename()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="h-6 min-w-0 flex-1 px-2 py-0 text-sm"
          />
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          onClick={() => void handleFileClick()}
          className="h-auto min-w-0 flex-1 justify-start gap-1 px-0 py-0 text-left font-normal"
        >
          <span
            aria-hidden="true"
            className="shrink-0"
            style={{ width: `${FILE_DISCLOSURE_SLOT_PX}px` }}
          />
          {isDrawingPath(node.path) ? (
            <ScribbleIcon
              aria-label="Drawing"
              className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60"
            />
          ) : null}
          <span className="block min-w-0 flex-1 truncate">{displayName}</span>
        </Button>
      )}

      <div
        className={cn(
          "flex shrink-0 items-center justify-end",
          (isHovered || isDropdownOpen) && !isRenaming
            ? "opacity-100"
            : "pointer-events-none opacity-0",
        )}
        style={{ width: `${ACTION_SLOT_PX}px` }}
      >
        {!isRenaming ? (
          <DropdownMenu onOpenChange={handleDropdownOpenChange}>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="rounded-sm"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <DotsThreeVerticalIcon className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem onClick={startRename}>
                <PencilSimpleIcon className="mr-2 h-4 w-4" />
                Rename
              </DropdownMenuItem>
              {node.kind === "file" ? (
                <DropdownMenuItem onClick={handleMove}>
                  <ArrowsDownUpIcon className="mr-2 h-4 w-4" />
                  Move
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={() => void handleOpenFileLocation()}>
                <FolderOpenIcon className="mr-2 h-4 w-4" />
                Open location
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (useSettingsStore.getState().confirmBeforeDelete) {
                    setIsConfirmingTrash(true);
                  } else {
                    void handleDelete();
                  }
                }}
                className="text-destructive"
              >
                <TrashIcon className="mr-2 h-4 w-4" />
                Move to Trash
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );

  const trashDialog = (
    <AlertDialog open={isConfirmingTrash} onOpenChange={setIsConfirmingTrash}>
      <AlertDialogContent aria-describedby={undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>Move “{displayName}” to Trash?</AlertDialogTitle>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => void handleDelete()}
          >
            Move to Trash
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (node.kind === "file") {
    return (
      <SidebarMenuItem className="w-full min-w-0 overflow-hidden">
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            if (!isDropdownOpen) {
              setIsHovered(false);
            }
          }}
          className="relative w-full min-w-0"
        >
          {rowGuides}
          {rowContent}
          {trashDialog}
          <MoveFileDialog
            open={isMoving}
            onOpenChange={setIsMoving}
            fileName={displayName}
            filePath={node.path}
            currentVaultPath={currentVaultPath}
            fileTree={fileTree}
            onMove={handleMoveToFolder}
          />
        </div>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="w-full min-w-0 overflow-hidden">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => {
            if (!isDropdownOpen) {
              setIsHovered(false);
            }
          }}
          className="relative w-full min-w-0"
        >
          {rowGuides}
          {rowContent}
          {trashDialog}
        </div>

        <CollapsibleContent className="w-full min-w-0 overflow-hidden">
          <div className="relative w-full min-w-0 overflow-hidden">
            {showChildrenGuide ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border/40"
                style={{ left: `${getGuideLeft(depth)}px` }}
              />
            ) : null}

            <SidebarMenu className="w-full min-w-0 overflow-hidden">
              {node.children?.map((child) => (
                <TreeNode key={child.path} node={child} depth={depth + 1} />
              ))}
            </SidebarMenu>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
