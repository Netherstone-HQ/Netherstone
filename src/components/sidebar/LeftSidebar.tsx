import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ChevronsUpDownIcon,
  FileIcon,
  FilePlusIcon,
  FolderIcon,
  FolderInputIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  GitBranchIcon,
  ImportIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Sidebar } from "@/components/ui/sidebar";
import { DrawingIcon } from "@/components/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { TagFilterField, TagList } from "../tags/TagList";
import { DataSidebar } from "../data/DataSidebar";
import { FileTree } from "../vault/FileTree";
import { ImportShardDialog } from "../vault/ImportShardDialog";
import { NewVaultDialog } from "../vault/NewVaultDialog";
import { openImportDialog } from "@/lib/import";
import { openEditorFile } from "@/lib/open-editor-file";
import {
  fileExists,
  openShardDialog,
  openVaultDialog,
  scanVault,
  importShard,
  type ShardDialogResult,
} from "@/lib/commands";
import { folderName, openVault } from "@/lib/open-vault";
import { createDrawing } from "@/lib/open-vault-file";
import { REVEAL_LABEL } from "@/lib/platform";
import { useMenuAction } from "@/lib/use-menu-action";
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
  const [isNewVaultOpen, setIsNewVaultOpen] = useState(false);
  const vaultMenu = useMenuAction();

  const setSearchModalOpen = useUIStore((s) => s.setSearchModalOpen);
  const isTagsMode = useUIStore((s) => s.appMode === "tags");
  const isDataMode = useUIStore((s) => s.appMode === "data");
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const openSettings = useUIStore((s) => s.openSettings);
  const { currentVaultPath, setFileTree } = useVaultStore();
  const recentVaults = useVaultStore((s) => s.recentVaults);
  const forgetRecentVault = useVaultStore((s) => s.forgetRecentVault);
  const setNewFolderParent = useVaultStore((s) => s.setNewFolderParent);

  const currentVaultName = currentVaultPath
    ? folderName(currentVaultPath)
    : "No vault";
  const otherVaults = recentVaults.filter(
    (path) => path !== currentVaultPath,
  );

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
    try {
      await openVault(vaultPath);
    } catch (error) {
      console.error("[Netherstone] Failed to open vault:", error);
      toast.error(`Couldn't open ${folderName(vaultPath)}`);
    }
  }

  async function switchToRecent(vaultPath: string) {
    if (!(await fileExists(vaultPath).catch(() => false))) {
      forgetRecentVault(vaultPath);
      toast.error(`Couldn't find ${folderName(vaultPath)}`, {
        description: "It was moved or deleted.",
      });
      return;
    }
    await switchVault(vaultPath);
  }

  async function handleOpenVault() {
    const path = await openVaultDialog();
    if (!path) return;
    await switchVault(path);
  }

  function newFolder() {
    if (!currentVaultPath) return;
    // Tags and Data list other things in place of the file tree the folder
    // is named in.
    if (isTagsMode || isDataMode) useUIStore.getState().openMode("editor");
    setNewFolderParent(currentVaultPath);
  }

  async function handleRevealVaultLocation() {
    if (!currentVaultPath) return;

    try {
      await revealItemInDir(currentVaultPath);
    } catch (error) {
      console.error("[Netherstone] Failed to reveal vault location:", error);
      toast.error("Couldn't show the vault's folder");
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
            <DropdownMenuContent
              side="bottom"
              align="start"
              className="w-60"
              onCloseAutoFocus={vaultMenu.onCloseAutoFocus}
            >
              {currentVaultPath ? (
                <>
                  <DropdownMenuItem onSelect={vaultMenu.defer(onNewShard)}>
                    <FilePlusIcon />
                    New shard
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void createDrawing(currentVaultPath)}
                  >
                    <DrawingIcon />
                    New drawing
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={vaultMenu.defer(newFolder)}>
                    <FolderPlusIcon />
                    New folder
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={vaultMenu.defer(() =>
                      openImportDialog(currentVaultPath),
                    )}
                  >
                    <ImportIcon />
                    Import…
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              ) : null}

              <DropdownMenuItem onSelect={() => void handleOpenShard()}>
                <FileIcon />
                Open shard
              </DropdownMenuItem>
              {otherVaults.length > 0 ? (
                <>
                  <DropdownMenuLabel>Recent vaults</DropdownMenuLabel>
                  {otherVaults.map((path) => (
                    <DropdownMenuItem
                      key={path}
                      title={path}
                      onSelect={() => void switchToRecent(path)}
                    >
                      <FolderIcon />
                      <span className="truncate">{folderName(path)}</span>
                    </DropdownMenuItem>
                  ))}
                </>
              ) : null}
              <DropdownMenuItem onSelect={() => void handleOpenVault()}>
                <FolderInputIcon />
                Open vault
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={vaultMenu.defer(() => setIsNewVaultOpen(true))}
              >
                <PlusIcon />
                New vault
              </DropdownMenuItem>

              {currentVaultPath ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => void handleRevealVaultLocation()}
                  >
                    <FolderOpenIcon />
                    {REVEAL_LABEL}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openSettings("vault")}>
                    <SettingsIcon />
                    Vault settings
                  </DropdownMenuItem>
                </>
              ) : null}
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
          {isTagsMode ? (
            <TagFilterField />
          ) : (
            <button
              type="button"
              onClick={() => setSearchModalOpen(true)}
              className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/25 font-medium text-sidebar-foreground/85 text-ui-sm shadow-xs outline-none transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
            >
              <SearchIcon className="size-4" />
              Search
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-x-hidden overflow-y-auto p-2">
          {isTagsMode ? (
            <TagList />
          ) : isDataMode ? (
            <DataSidebar />
          ) : (
            <>
              <PinnedSection />
              <RecentFilesSection />
              <FileTree onNewShard={onNewShard} />
            </>
          )}
        </div>
      </Sidebar>

      <NewVaultDialog open={isNewVaultOpen} onOpenChange={setIsNewVaultOpen} />

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
