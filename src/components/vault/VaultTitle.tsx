import { useState, useRef, useEffect } from "react";
import { useVaultStore } from "@/store/vault";
import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useShallow } from "zustand/shallow";
import {
  CaretRightIcon,
  DotsThreeIcon,
  FloppyDiskIcon,
  XIcon,
  PencilSimpleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@/components/ui/input";
import { getSaveMarkdownContent } from "@/lib/editor-markdown";
import { serializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { upsertAstCache } from "@/lib/editor-ast-cache";
import { applyOpenEditorSessionPathChange } from "@/lib/open-editor-session-path-change";
import { suppressVaultChangePaths } from "@/lib/vault-change-suppression";

function getCloseLifecycleNowMs(): number {
  return typeof window !== "undefined" && "performance" in window
    ? window.performance.now()
    : Date.now();
}

function getCloseLifecycleDurationMs(startMs: number): number {
  return Number((getCloseLifecycleNowMs() - startMs).toFixed(2));
}

function logCloseLifecycle(
  event: string,
  details: Record<string, unknown>,
): void {
  console.info("[Netherstone][Vault Title][Close Lifecycle]", event, details);
}

export function VaultTitle() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const {
    currentFilePath,
    markdownContent,
    plateEditor,
    closeFile,
    markSaved,
  } = useEditorStore(
    useShallow((s) => ({
      closeFile: s.closeFile,
      markdownContent: s.markdownContent,
      currentFilePath: s.currentFilePath,
      markSaved: s.markSaved,
      plateEditor: s.plateEditor,
    })),
  );

  const updateRecentFilePath = useUIStore((s) => s.updateRecentFilePath);

  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isRenameSubmittingRef = useRef(false);

  const vaultName = currentVaultPath
    ? (currentVaultPath.split(/[\\/]/).pop() ?? currentVaultPath)
    : null;

  const getBreadcrumbs = () => {
    if (!currentFilePath || !currentVaultPath) return [];

    const vaultPath = currentVaultPath.replace(/\\/g, "/");
    const filePath = currentFilePath.replace(/\\/g, "/");

    if (filePath.startsWith(vaultPath)) {
      const relativePath = filePath.substring(vaultPath.length + 1);
      return relativePath.split("/");
    }

    return [];
  };

  const breadcrumbs = getBreadcrumbs();
  const fileName = breadcrumbs[breadcrumbs.length - 1];
  const displayFileName = fileName?.replace(/\.md$/i, "") ?? fileName;
  const folders = breadcrumbs.slice(0, -1);

  const serializeCurrentContent = async (requestKey?: string) => {
    if (!plateEditor) {
      return markdownContent;
    }

    return serializeMarkdownInWorker(plateEditor.children, {
      timeoutMs: 5000,
      filePath: currentFilePath,
      requestKey,
      fallback: () => getSaveMarkdownContent(plateEditor, markdownContent),
    });
  };

  const refreshAstCache = async (
    filePath: string,
    markdown: string,
    reason: "manual-save" | "close-save" | "rename-save",
  ) => {
    if (!plateEditor) {
      console.info(
        `[Netherstone] Skipping AST cache refresh (${reason}) for ${filePath}: no plate editor`,
      );
      return;
    }

    try {
      console.info(
        `[Netherstone] Refreshing AST cache (${reason}) for ${filePath}`,
      );

      await upsertAstCache({
        filePath,
        markdown,
        plateValue: plateEditor.children,
      });

      console.info(
        `[Netherstone] Refreshed AST cache (${reason}) for ${filePath}`,
      );
    } catch (error) {
      console.error(
        `[Netherstone] Failed to refresh AST cache (${reason}) for ${filePath}:`,
        error,
      );
    }
  };

  const handleSave = async () => {
    if (!currentFilePath) return;

    try {
      const content = await serializeCurrentContent(
        currentFilePath ? `manual-save:${currentFilePath}` : "manual-save",
      );

      if (content === markdownContent) {
        markSaved();
        return;
      }

      suppressVaultChangePaths([currentFilePath], {
        reason: "manual-save",
      });

      await invoke("save_markdown_file", {
        filePath: currentFilePath,
        content,
      });

      await refreshAstCache(currentFilePath, content, "manual-save");
      markSaved(content);
    } catch (error) {
      console.error("Failed to save file:", error);
    }
  };

  const handleClose = async () => {
    const closeStartMs = getCloseLifecycleNowMs();
    const editorState = useEditorStore.getState();
    const { isDirty } = editorState;
    const closingFilePath = currentFilePath;

    logCloseLifecycle("close:start", {
      filePath: closingFilePath,
      isDirty,
      hasPlateEditor: plateEditor !== null,
      markdownChars: markdownContent.length,
    });

    if (currentFilePath && isDirty) {
      const closeSaveStartMs = getCloseLifecycleNowMs();

      try {
        logCloseLifecycle("close:save:start", {
          filePath: currentFilePath,
        });

        const content = await serializeCurrentContent(
          currentFilePath ? `close:${currentFilePath}` : "close",
        );

        logCloseLifecycle("close:save:serialized", {
          filePath: currentFilePath,
          markdownChars: content.length,
          serializeDurationMs: getCloseLifecycleDurationMs(closeSaveStartMs),
        });

        suppressVaultChangePaths([currentFilePath], {
          reason: "close-save",
        });

        await invoke("save_markdown_file", {
          filePath: currentFilePath,
          content,
        });

        logCloseLifecycle("close:save:persisted", {
          filePath: currentFilePath,
          persistDurationMs: getCloseLifecycleDurationMs(closeSaveStartMs),
        });

        await refreshAstCache(currentFilePath, content, "close-save");

        logCloseLifecycle("close:save:cache-refreshed", {
          filePath: currentFilePath,
          totalSaveDurationMs: getCloseLifecycleDurationMs(closeSaveStartMs),
        });

        markSaved(content);

        logCloseLifecycle("close:save:marked-saved", {
          filePath: currentFilePath,
          totalSaveDurationMs: getCloseLifecycleDurationMs(closeSaveStartMs),
        });
      } catch (error) {
        console.error("Failed to save file before closing:", error);
        logCloseLifecycle("close:save:error", {
          filePath: currentFilePath,
          totalSaveDurationMs: getCloseLifecycleDurationMs(closeSaveStartMs),
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      }
    }

    logCloseLifecycle("close:store-close:start", {
      filePath: closingFilePath,
      totalCloseDurationMs: getCloseLifecycleDurationMs(closeStartMs),
    });

    closeFile();

    logCloseLifecycle("close:store-close:complete", {
      filePath: closingFilePath,
      totalCloseDurationMs: getCloseLifecycleDurationMs(closeStartMs),
    });
  };

  const startRename = () => {
    if (!fileName) return;

    const nameWithoutExt = fileName.replace(/\.md$/i, "");
    setNewName(nameWithoutExt);
    setIsRenaming(true);
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setNewName("");
  };

  const handleRename = async () => {
    if (isRenameSubmittingRef.current) return;

    const trimmedName = newName.trim();

    if (!currentFilePath || !trimmedName) {
      cancelRename();
      return;
    }

    const currentNameWithoutExt = fileName?.replace(/\.md$/i, "") ?? "";
    if (trimmedName === currentNameWithoutExt) {
      cancelRename();
      return;
    }

    isRenameSubmittingRef.current = true;

    try {
      suppressVaultChangePaths([currentFilePath], {
        reason: "rename",
      });

      const content = await serializeCurrentContent(
        currentFilePath ? `rename:${currentFilePath}` : "rename",
      );
      const selectionBeforeRename = plateEditor?.selection
        ? JSON.parse(JSON.stringify(plateEditor.selection))
        : null;

      const mainElement = document.querySelector("main");
      const scrollTopBeforeRename =
        mainElement instanceof HTMLElement ? mainElement.scrollTop : null;

      await invoke("save_markdown_file", {
        filePath: currentFilePath,
        content,
      });

      const newPath = await invoke<string>("rename_file", {
        oldPath: currentFilePath,
        newName: trimmedName,
      });

      suppressVaultChangePaths([currentFilePath, newPath], {
        reason: "rename",
      });

      updateRecentFilePath(currentFilePath, newPath);
      await refreshAstCache(newPath, content, "rename-save");

      applyOpenEditorSessionPathChange(newPath, content, {
        selection: selectionBeforeRename,
        scrollTop: scrollTopBeforeRename,
      });

      if (currentVaultPath) {
        const fileTree = await invoke("scan_vault", {
          vaultPath: currentVaultPath,
        });
        useVaultStore.getState().setFileTree(fileTree as any);

        await invoke("index_vault", { vaultPath: currentVaultPath });
      }

      cancelRename();
    } catch (error) {
      console.error("Failed to rename file:", error);
      alert(error instanceof Error ? error.message : String(error));
      cancelRename();
    } finally {
      isRenameSubmittingRef.current = false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  };

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isRenaming]);

  if (!vaultName) {
    return <span className="text-sm text-muted-foreground">No vault open</span>;
  }

  if (!currentFilePath) {
    return <span className="text-sm font-medium">{vaultName}</span>;
  }

  return (
    <div className="flex items-center gap-1 text-sm">
      <span className="font-medium">{vaultName}</span>

      {folders.length > 0 && (
        <>
          <CaretRightIcon className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">{folders.join(" / ")}</span>
        </>
      )}

      <CaretRightIcon className="h-3 w-3 text-muted-foreground" />
      {isRenaming ? (
        <Input
          ref={inputRef}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            void handleRename();
          }}
          className="h-6 w-48 px-2 py-0 text-sm"
        />
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={startRename}
          className="group h-auto gap-1 px-1 font-normal"
        >
          <span className="font-medium">{displayFileName}</span>
          <PencilSimpleIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-50" />
        </Button>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon-sm" className="ml-1">
            <DotsThreeIcon className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onClick={() => void handleSave()}>
            <FloppyDiskIcon className="mr-2 h-4 w-4" />
            Save
          </DropdownMenuItem>
          <DropdownMenuItem onClick={startRename}>
            <PencilSimpleIcon className="mr-2 h-4 w-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleClose}>
            <XIcon className="mr-2 h-4 w-4" />
            Close
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
