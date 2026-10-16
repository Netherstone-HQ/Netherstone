import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChevronsUpDownIcon,
  FileIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  SearchIcon,
} from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Sidebar } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BackupPanel } from "@/components/sync/BackupPanel";
import { ConflictDialog } from "@/components/sync/ConflictDialog";
import { cn } from "@/lib/utils";
import { useSyncStore } from "@/store/sync";
import { PinnedSection } from "../recent/PinnedSection";
import { RecentFilesSection } from "../recent/RecentFilesSection";
import { FileTree } from "../vault/FileTree";
import { ImportShardDialog } from "../vault/ImportShardDialog";
import { openEditorFile } from "@/lib/open-editor-file";
import {
  openShardDialog,
  openVaultDialog,
  scanVault,
  importShard,
  type ShardDialogResult,
} from "@/lib/commands";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store";
import { LeftSidebarResizeHandle } from "./LeftSidebarResizeHandle";

interface LeftSidebarProps {
  onNewShard: () => void;
}

export function LeftSidebar({ onNewShard }: LeftSidebarProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pendingShard, setPendingShard] = useState<ShardDialogResult | null>(
    null,
  );

  const setSearchModalOpen = useUIStore((s) => s.setSearchModalOpen);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const {
    currentVaultPath,
    setCurrentVaultPath,
    setFileTree,
    setVaultLoading,
  } = useVaultStore();

  const currentVaultName = currentVaultPath?.split(/[\\/]/).pop() || "No vault";

  const loadBackupState = useSyncStore((s) => s.load);
  const backupIndicator = useSyncStore((s) => {
    if (s.vaultPath !== currentVaultPath || !s.record?.syncEnabled) return null;
    if (s.error || s.record.conflicts.length > 0) return "attention";
    return s.offline ? "offline" : "ok";
  });

  useEffect(() => {
    if (currentVaultPath) void loadBackupState(currentVaultPath);
  }, [currentVaultPath, loadBackupState]);

  async function openShardWithContent(filePath: string) {
    await openEditorFile(filePath);
  }

  async function switchVault(vaultPath: string) {
    setCurrentVaultPath(vaultPath);
    setVaultLoading(true);
    try {
      const tree = await scanVault(vaultPath);
      setFileTree(tree);
    } catch (err) {
      console.error("[Netherstone] Failed to scan vault:", err);
    } finally {
      setVaultLoading(false);
    }
  }

  async function handleOpenVault() {
    const path = await openVaultDialog();
    if (!path) return;
    await switchVault(path);
  }

  async function handleRevealVaultLocation() {
    if (!currentVaultPath) return;

    try {
      await openPath(currentVaultPath);
    } catch (error) {
      console.error("[Netherstone] Failed to reveal vault location:", error);
      toast.error("Failed to open vault location", {
        description:
          error instanceof Error
            ? error.message
            : "Could not open the OS file explorer.",
      });
    }
  }

  async function handleOpenShard() {
    const result = await openShardDialog();
    if (!result) return;

    const { filePath, vaultPath } = result;

    const norm = (p: string) => p.replace(/\\/g, "/");
    const isInCurrentVault =
      currentVaultPath !== null &&
      norm(filePath).startsWith(norm(currentVaultPath) + "/");

    if (isInCurrentVault) {
      await openShardWithContent(filePath);
      return;
    }

    if (currentVaultPath === null) {
      await switchVault(vaultPath);
      await openShardWithContent(filePath);
      return;
    }

    setPendingShard(result);
  }

  async function handleImport() {
    if (!pendingShard || !currentVaultPath) return;
    try {
      const copiedPath = await importShard(
        pendingShard.filePath,
        currentVaultPath,
      );
      const tree = await scanVault(currentVaultPath);
      setFileTree(tree);
      await openShardWithContent(copiedPath);
    } catch (err) {
      console.error("[Netherstone] Failed to import shard:", err);
    } finally {
      setPendingShard(null);
    }
  }

  async function handleOpenItsVault() {
    if (!pendingShard) return;
    await switchVault(pendingShard.vaultPath);
    await openShardWithContent(pendingShard.filePath);
    setPendingShard(null);
  }

  return (
    <div
      ref={containerRef}
      className="relative z-31"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <Sidebar
        collapsible="offcanvas"
        side="left"
        className="overflow-hidden data-[side=left]:left-12"
      >
        {/* Lines up with the app's top bar. */}
        <div className="flex h-header shrink-0 items-center gap-1.5 border-b px-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent/60"
              >
                <span className="flex size-6.5 shrink-0 items-center justify-center rounded-md bg-sidebar-accent text-sidebar-foreground">
                  <FolderIcon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ui">
                  {currentVaultName}
                </span>
                <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="start" className="w-56">
              <DropdownMenuItem onClick={() => void handleOpenVault()}>
                <FolderOpenIcon />
                <span>Open vault</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleOpenShard()}>
                <FileIcon />
                <span>Open shard</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!currentVaultPath}
                onClick={() => void handleRevealVaultLocation()}
              >
                <FolderIcon />
                <span>Open location</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Popover>
            <Hint label="Sync" side="bottom">
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={!currentVaultPath}
                  className="relative flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-expanded:bg-sidebar-accent/60"
                  aria-label="Sync"
                >
                  <GitBranchIcon className="size-5" />
                  {backupIndicator ? (
                    <span
                      className={cn(
                        "absolute top-1.5 right-1.5 size-2 rounded-full ring-2 ring-sidebar",
                        backupIndicator === "ok"
                          ? "bg-emerald-500"
                          : backupIndicator === "offline"
                            ? "bg-muted-foreground"
                            : "bg-amber-500",
                      )}
                    />
                  ) : null}
                </button>
              </PopoverTrigger>
            </Hint>
            {currentVaultPath ? (
              <PopoverContent side="bottom" align="end" className="w-80">
                <BackupPanel vaultPath={currentVaultPath} />
              </PopoverContent>
            ) : null}
          </Popover>
          {currentVaultPath ? <ConflictDialog vaultPath={currentVaultPath} /> : null}
        </div>

        {/* Sized and placed like the editor toolbar's buttons beside it. */}
        <div className="flex h-10 shrink-0 items-center px-2">
          <button
            type="button"
            onClick={() => setSearchModalOpen(true)}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/25 font-medium text-sidebar-foreground/85 text-ui-sm shadow-xs outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          >
            <SearchIcon className="size-4" />
            Search
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-2">
          <PinnedSection />
          <RecentFilesSection />
          <FileTree onNewShard={onNewShard} />
        </div>
      </Sidebar>

      <ImportShardDialog
        shard={pendingShard}
        onImport={handleImport}
        onOpenVault={handleOpenItsVault}
        onClose={() => setPendingShard(null)}
      />

      <LeftSidebarResizeHandle
        containerRef={containerRef}
        sidebarWidth={sidebarWidth}
        setSidebarWidth={setSidebarWidth}
      />
    </div>
  );
}
