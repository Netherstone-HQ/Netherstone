import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckIcon,
  FilePlusIcon,
  ImageIcon,
  PencilIcon,
  PencilLineIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import type { DrawingSaveStatus } from "@/components/ExcalidrawCanvas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createDrawingFile, scanVault } from "@/lib/commands";
import { relinkDrawingReferences } from "@/lib/drawing-exports";
import {
  flattenDrawingFiles,
  flushPendingDrawingSave,
  getVaultFileDisplayName,
} from "@/lib/drawing-files";
import { openDrawingFile } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import { suppressVaultChangePaths } from "@/lib/vault-change-suppression";
import { useUIStore, useVaultStore } from "@/store";

interface DrawingMenuProps {
  /** The open vault drawing, or null for an empty canvas. */
  drawingPath: string | null;
  saveStatus: DrawingSaveStatus;
  /** Opens the image export dialog, which can export into a shard. */
  onExport: () => void;
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** Folder of `filePath` relative to the vault, or "" at the vault root. */
function getRelativeFolder(filePath: string, vaultPath: string | null) {
  const normalized = filePath.replace(/\\/g, "/");
  const root = (vaultPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  const relative =
    root && normalized.startsWith(`${root}/`)
      ? normalized.slice(root.length + 1)
      : normalized;
  const slashIndex = relative.lastIndexOf("/");

  return slashIndex >= 0 ? relative.slice(0, slashIndex) : "";
}

async function refreshFileTree(vaultPath: string | null) {
  if (!vaultPath) return;
  useVaultStore.getState().setFileTree(await scanVault(vaultPath));
}

function showError(message: string, error: unknown) {
  console.error(`[Netherstone] ${message}:`, error);
  toast.error(message, {
    description: error instanceof Error ? error.message : String(error),
  });
}

/**
 * Canvas title and drawing switcher, styled with Excalidraw's sidebar-trigger
 * class so it matches the Library button beside it. A dot after the name
 * shows unsaved changes; the open drawing is renamed in place.
 */
export function DrawingMenu({
  drawingPath,
  saveStatus,
  onExport,
}: DrawingMenuProps) {
  const fileTree = useVaultStore((s) => s.fileTree);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const drawings = useMemo(() => flattenDrawingFiles(fileTree), [fileTree]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const isCommittingRef = useRef(false);

  const title = drawingPath
    ? getVaultFileDisplayName(getFileName(drawingPath))
    : "Untitled";
  const statusText = !currentVaultPath
    ? "Open a vault to save drawings"
    : saveStatus === "error"
      ? "Couldn't save changes"
      : saveStatus === "saving"
        ? "Saving…"
        : drawingPath
          ? "All changes saved"
          : "Not saved yet";

  const handleNewDrawing = async () => {
    if (!currentVaultPath) return;

    try {
      const filePath = await createDrawingFile(currentVaultPath, "Untitled");
      await openDrawingFile(filePath);
      await refreshFileTree(currentVaultPath);
    } catch (error) {
      showError("Couldn't create drawing", error);
    }
  };

  const startRename = () => {
    setNewName(title);
    setIsRenaming(true);
  };

  const commitRename = async () => {
    if (isCommittingRef.current) return;

    const trimmedName = newName.trim();
    if (!drawingPath || !trimmedName || trimmedName === title) {
      setIsRenaming(false);
      return;
    }

    isCommittingRef.current = true;

    try {
      await flushPendingDrawingSave();
      suppressVaultChangePaths([drawingPath], { reason: "rename" });

      const renamedPath = await invoke<string>("rename_file", {
        oldPath: drawingPath,
        newName: trimmedName,
      });

      const ui = useUIStore.getState();
      ui.setActiveDrawingPath(renamedPath);
      ui.updateRecentFilePath(drawingPath, renamedPath);
      await refreshFileTree(currentVaultPath);
      if (currentVaultPath) {
        await relinkDrawingReferences(
          drawingPath,
          renamedPath,
          currentVaultPath,
        ).catch((error) =>
          console.error(
            "[Netherstone] Failed to relink drawing exports:",
            error,
          ),
        );
      }
    } catch (error) {
      showError("Couldn't rename drawing", error);
    } finally {
      isCommittingRef.current = false;
      setIsRenaming(false);
    }
  };

  const handleDelete = async () => {
    if (!drawingPath) return;

    try {
      await flushPendingDrawingSave();
      await invoke("delete_vault_path", { targetPath: drawingPath });

      const ui = useUIStore.getState();
      ui.removeRecentFile(drawingPath);
      ui.openDrawing(null);
      await refreshFileTree(currentVaultPath);
      toast.success(`Moved ${title} to Trash`);
    } catch (error) {
      showError("Couldn't move drawing to Trash", error);
    }
  };

  if (isRenaming) {
    return (
      <div className="sidebar-trigger default-sidebar-trigger shadow-[0_0_0_1px_var(--color-brand-hover)]!">
        <PencilLineIcon />
        <input
          aria-label="Drawing name"
          className="w-40 bg-transparent text-xs leading-normal shadow-none! outline-none"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setIsRenaming(false);
            }
          }}
          autoFocus
        />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="sidebar-trigger default-sidebar-trigger"
          title={statusText}
        >
          <PencilLineIcon />
          <span className="sidebar-trigger__label max-w-48 truncate leading-normal">
            {title}
          </span>
          {currentVaultPath && saveStatus !== "saved" ? (
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                saveStatus === "error"
                  ? "bg-destructive"
                  : "animate-pulse bg-amber-500",
              )}
            />
          ) : null}
          <span className="sr-only" aria-live="polite">
            {statusText}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        // Keep focus in the rename field instead of returning it here.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem
          disabled={!currentVaultPath}
          onSelect={() => void handleNewDrawing()}
        >
          <FilePlusIcon />
          New drawing
        </DropdownMenuItem>
        {drawingPath ? (
          <>
            <DropdownMenuItem onSelect={onExport}>
              <ImageIcon />
              Export to shard
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={startRename}>
              <PencilIcon />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => void handleDelete()}
            >
              <Trash2Icon />
              Move to Trash
            </DropdownMenuItem>
          </>
        ) : null}

        {drawings.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Drawings
            </DropdownMenuLabel>
            {drawings.map((drawing) => {
              const folder = getRelativeFolder(drawing.path, currentVaultPath);

              return (
                <DropdownMenuItem
                  key={drawing.path}
                  title={drawing.path}
                  onSelect={() => {
                    void openDrawingFile(drawing.path).catch((error) =>
                      showError("Couldn't open drawing", error),
                    );
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {getVaultFileDisplayName(drawing.name)}
                  </span>
                  {folder ? (
                    <span className="max-w-24 truncate text-xs text-muted-foreground">
                      {folder}
                    </span>
                  ) : null}
                  {drawing.path === drawingPath ? <CheckIcon /> : null}
                </DropdownMenuItem>
              );
            })}
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
