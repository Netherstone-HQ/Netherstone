import { useState } from "react";
import { FilePlusIcon, FolderSimplePlusIcon } from "@phosphor-icons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useVaultStore } from "@/store";
import { CollapsedNode } from "@/components/vault/CollapsedNode";
import { FileTreeSkeleton } from "@/components/vault/FileTreeSkeleton";
import { NewFolderRow } from "@/components/vault/NewFolderRow";
import { NewShardDialog } from "@/components/vault/NewShardDialog";
import { TreeNode } from "@/components/vault/TreeNode";

interface FileTreeProps {
  onNewShard: () => void;
}

const GROUP_ACTION_CLASS =
  "text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground";

export function FileTree({ onNewShard }: FileTreeProps) {
  const { state } = useSidebar();
  const { fileTree, isVaultLoading, currentVaultPath } = useVaultStore();
  const newFolderParent = useVaultStore((s) => s.newFolderParent);
  const setNewFolderParent = useVaultStore((s) => s.setNewFolderParent);
  const [isCreatingRootShard, setIsCreatingRootShard] = useState(false);

  if (!currentVaultPath) return null;

  if (state === "collapsed") {
    return (
      <SidebarGroup>
        <SidebarGroupContent>
          <SidebarMenu>
            {fileTree.map((node) => (
              <CollapsedNode key={node.path} node={node} />
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
    );
  }

  const isNamingRootFolder = newFolderParent === currentVaultPath;
  const startRootFolder = () => setNewFolderParent(currentVaultPath);

  return (
    <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SidebarGroupLabel className="shrink-0 px-2">Shards</SidebarGroupLabel>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <SidebarGroupAction
            onClick={startRootFolder}
            aria-label="Create new folder"
            className={`right-9 ${GROUP_ACTION_CLASS}`}
          >
            <FolderSimplePlusIcon />
          </SidebarGroupAction>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          New Folder
        </TooltipContent>
      </Tooltip>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <SidebarGroupAction
            onClick={onNewShard}
            aria-label="Create new shard"
            className={GROUP_ACTION_CLASS}
          >
            <FilePlusIcon />
          </SidebarGroupAction>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          New Shard
        </TooltipContent>
      </Tooltip>
      <SidebarGroupContent className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <SidebarMenu className="w-full min-w-0 gap-0.5">
          {isNamingRootFolder ? (
            <NewFolderRow parent={currentVaultPath} depth={0} />
          ) : null}
          {isVaultLoading ? (
            <FileTreeSkeleton />
          ) : fileTree.length === 0 && !isNamingRootFolder ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
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
          <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
            <ContextMenuItem onSelect={() => setIsCreatingRootShard(true)}>
              <FilePlusIcon />
              New Shard
            </ContextMenuItem>
            <ContextMenuItem onSelect={startRootFolder}>
              <FolderSimplePlusIcon />
              New Folder
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </SidebarGroupContent>

      <NewShardDialog
        open={isCreatingRootShard}
        onOpenChange={setIsCreatingRootShard}
        folder={currentVaultPath}
      />
    </SidebarGroup>
  );
}
