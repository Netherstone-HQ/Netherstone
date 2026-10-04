import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CaretUpDownIcon,
  FileIcon,
  FilePlusIcon,
  FolderOpenIcon,
  GitBranchIcon,
  FolderSimpleIcon,
  MagnifyingGlassIcon,
  TagIcon,
} from "@phosphor-icons/react";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BackupPanel } from "@/components/sync/BackupPanel";
import { ConflictDialog } from "@/components/sync/ConflictDialog";
import { cn } from "@/lib/utils";
import { useSyncStore } from "@/store/sync";
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

  const activeNavItem = useUIStore((s) => s.activeNavItem);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);
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
        <div className="flex gap-2 px-2 pt-1.5 pb-2">
          <SidebarMenuButton
            tooltip="Search"
            className="h-9 flex-1 justify-center gap-2 border border-sidebar-border/60 bg-sidebar-accent/25 font-medium text-sidebar-foreground/85 shadow-xs hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            onClick={() => setSearchModalOpen(true)}
          >
            <MagnifyingGlassIcon className="relative top-px shrink-0" />
            <span className="text-center leading-none">Search</span>
          </SidebarMenuButton>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  setActiveNavItem(activeNavItem === "tags" ? null : "tags")
                }
                className={
                  activeNavItem === "tags"
                    ? "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-sidebar-border/60 bg-sidebar-accent text-sidebar-accent-foreground shadow-xs transition-colors"
                    : "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-sidebar-border/60 bg-sidebar-accent/25 text-sidebar-foreground/85 shadow-xs transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                }
                aria-label="Tags"
                aria-pressed={activeNavItem === "tags"}
              >
                <TagIcon className="size-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Tags
            </TooltipContent>
          </Tooltip>
        </div>

        {/* ── Scrollable Content ────────────────────────────────── */}
        <SidebarContent className="min-h-0 overflow-x-hidden overflow-y-auto">
          {/* Recent Files */}
          <RecentFilesSection />

          {/* File Tree */}
          <FileTree onNewShard={onNewShard} />
        </SidebarContent>

        {/* ── Footer ───────────────────────────────────────────── */}
        <SidebarFooter>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="min-w-0 flex-1 justify-between"
                  tooltip="Vault"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex aspect-square size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-accent/40 text-sidebar-foreground">
                      <FolderOpenIcon className="size-4" />
                    </div>
                    <div className="min-w-0 text-left">
                      <div className="truncate font-medium">
                        {currentVaultName}
                      </div>
                    </div>
                  </div>
                  <CaretUpDownIcon className="size-3.5 shrink-0 text-sidebar-foreground/60" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="w-56">
                <DropdownMenuItem onClick={() => void handleOpenVault()}>
                  <FolderOpenIcon />
                  <span>Open Vault</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void handleOpenShard()}>
                  <FileIcon />
                  <span>Open Shard</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!currentVaultPath}
                  onClick={() => void handleRevealVaultLocation()}
                >
                  <FolderSimpleIcon />
                  <span>Open in Explorer</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onNewShard}>
                  <FilePlusIcon />
                  <span>New Shard</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Popover>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={!currentVaultPath}
                      className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50"
                      aria-label="Sync"
                    >
                      <GitBranchIcon className="size-5" />
                      {backupIndicator ? (
                        <span
                          className={cn(
                            "absolute top-3 right-3 size-2 rounded-full ring-2 ring-sidebar",
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
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={6}>
                  Sync
                </TooltipContent>
              </Tooltip>
              {currentVaultPath ? (
                <PopoverContent side="top" align="end" className="w-80">
                  <BackupPanel vaultPath={currentVaultPath} />
                </PopoverContent>
              ) : null}
            </Popover>
            {currentVaultPath ? <ConflictDialog vaultPath={currentVaultPath} /> : null}
          </div>
        </SidebarFooter>
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
