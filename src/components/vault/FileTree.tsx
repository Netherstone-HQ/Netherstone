import {
  ChevronsDownUpIcon,
  FilePlusIcon,
  FolderPlusIcon,
  PlusIcon,
} from "lucide-react";

import { DrawingIcon } from "@/components/icons";
import { SectionHeader } from "@/components/sidebar/SectionHeader";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu } from "@/components/ui/sidebar";
import { Hint } from "@/components/ui/tooltip";
import { isPathWithin } from "@/lib/drawing-files";
import { useUIStore, useVaultStore } from "@/store";
import { FileTreeSkeleton } from "@/components/vault/FileTreeSkeleton";
import { NewFolderRow } from "@/components/vault/NewFolderRow";
import { TreeNode } from "@/components/vault/TreeNode";
import { useTreeDropTarget } from "@/components/vault/useTreeDropTarget";
import { createDrawing, createShard } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import { useMenuAction } from "@/lib/use-menu-action";

export function FileTree() {
  const { fileTree, isVaultLoading, currentVaultPath } = useVaultStore();
  const newFolderParent = useVaultStore((s) => s.newFolderParent);
  const setNewFolderParent = useVaultStore((s) => s.setNewFolderParent);
  const hasOpenFolder = useUIStore((s) =>
    currentVaultPath
      ? s.openFolders.some((path) => isPathWithin(path, currentVaultPath))
      : false,
  );
  const collapseAllFolders = useUIStore((s) => s.collapseAllFolders);
  const addMenu = useMenuAction();
  const rootMenu = useMenuAction();
  // Folders inside the tree take their own drops; the rest is the vault root.
  const rootDrop = useTreeDropTarget(currentVaultPath);

  if (!currentVaultPath) return null;

  const isNamingRootFolder = newFolderParent === currentVaultPath;
  const startRootFolder = () => setNewFolderParent(currentVaultPath);
  const newDrawing = () => createDrawing(currentVaultPath);
  // The header's New follows Settings; the space below the tree is the root.
  const newShard = () => void createShard(currentVaultPath);
  const newRootShard = () => void createShard(currentVaultPath, currentVaultPath);

  return (
    <section
      aria-label="Files"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <SectionHeader
        label="Files"
        labelAction={
          hasOpenFolder ? (
            <Hint label="Collapse all">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Collapse all"
                className="text-muted-foreground"
                onClick={() => collapseAllFolders(currentVaultPath)}
              >
                <ChevronsDownUpIcon />
              </Button>
            </Hint>
          ) : null
        }
      >
        <DropdownMenu>
          <Hint label="New">
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="New"
                className="text-muted-foreground"
              >
                <PlusIcon />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={addMenu.onCloseAutoFocus}
          >
            <DropdownMenuItem onSelect={addMenu.defer(newShard)}>
              <FilePlusIcon />
              New shard
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void newDrawing()}>
              <DrawingIcon />
              New drawing
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addMenu.defer(startRootFolder)}>
              <FolderPlusIcon />
              New folder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SectionHeader>

      <div
        ref={(el: HTMLDivElement | null) => {
          rootDrop.connect(el);
        }}
        className={cn(
          "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden rounded-md transition-colors",
          rootDrop.isDropTarget && "bg-sidebar-accent/40",
        )}
      >
        <SidebarMenu className="w-full min-w-0 gap-0.5">
          {isNamingRootFolder ? (
            <NewFolderRow parent={currentVaultPath} depth={0} />
          ) : null}
          {isVaultLoading ? (
            <FileTreeSkeleton />
          ) : fileTree.length === 0 && !isNamingRootFolder ? (
            <p className="px-2 py-4 text-ui-sm text-muted-foreground">
              No shards found in this vault.
            </p>
          ) : (
            fileTree.map((node) => <TreeNode key={node.path} node={node} />)
          )}
        </SidebarMenu>

        {/* The space below the tree stands for the vault itself. */}
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div aria-hidden="true" className="min-h-8 flex-1" />
          </ContextMenuTrigger>
          <ContextMenuContent onCloseAutoFocus={rootMenu.onCloseAutoFocus}>
            <ContextMenuItem onSelect={rootMenu.defer(newRootShard)}>
              <FilePlusIcon />
              New shard
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void newDrawing()}>
              <DrawingIcon />
              New drawing
            </ContextMenuItem>
            <ContextMenuItem onSelect={rootMenu.defer(startRootFolder)}>
              <FolderPlusIcon />
              New folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </section>
  );
}
