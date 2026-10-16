import { useState } from "react";
import { FilePlusIcon, FolderPlusIcon, PlusIcon } from "lucide-react";

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
import { useVaultStore } from "@/store";
import { FileTreeSkeleton } from "@/components/vault/FileTreeSkeleton";
import { NewFolderRow } from "@/components/vault/NewFolderRow";
import { NewShardDialog } from "@/components/vault/NewShardDialog";
import { TreeNode } from "@/components/vault/TreeNode";
import { useTreeDropTarget } from "@/components/vault/useTreeDropTarget";
import { createDrawing } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import { useMenuAction } from "@/lib/use-menu-action";

interface FileTreeProps {
  onNewShard: () => void;
}

export function FileTree({ onNewShard }: FileTreeProps) {
  const { fileTree, isVaultLoading, currentVaultPath } = useVaultStore();
  const newFolderParent = useVaultStore((s) => s.newFolderParent);
  const setNewFolderParent = useVaultStore((s) => s.setNewFolderParent);
  const [isCreatingRootShard, setIsCreatingRootShard] = useState(false);
  const addMenu = useMenuAction();
  const rootMenu = useMenuAction();
  // Folders inside the tree take their own drops; the rest is the vault root.
  const rootDrop = useTreeDropTarget(currentVaultPath);

  if (!currentVaultPath) return null;

  const isNamingRootFolder = newFolderParent === currentVaultPath;
  const startRootFolder = () => setNewFolderParent(currentVaultPath);
  const newDrawing = () => createDrawing(currentVaultPath);

  return (
    <section
      aria-label="Files"
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
    >
      <SectionHeader label="Files">
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
            <DropdownMenuItem onSelect={addMenu.defer(onNewShard)}>
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
            <ContextMenuItem
              onSelect={rootMenu.defer(() => setIsCreatingRootShard(true))}
            >
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

      <NewShardDialog
        open={isCreatingRootShard}
        onOpenChange={setIsCreatingRootShard}
        folder={currentVaultPath}
      />
    </section>
  );
}
