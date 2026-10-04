import { PlusCircleIcon } from "@phosphor-icons/react";
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
import { TreeNode } from "@/components/vault/TreeNode";

interface FileTreeProps {
  onNewShard: () => void;
}

export function FileTree({ onNewShard }: FileTreeProps) {
  const { state } = useSidebar();
  const { fileTree, isVaultLoading, currentVaultPath } = useVaultStore();

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

  return (
    <SidebarGroup className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <SidebarGroupLabel className="shrink-0 px-2">Shards</SidebarGroupLabel>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <SidebarGroupAction
            onClick={onNewShard}
            aria-label="Create new shard"
            className="text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <PlusCircleIcon />
          </SidebarGroupAction>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          New Shard
        </TooltipContent>
      </Tooltip>
      <SidebarGroupContent className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <SidebarMenu className="w-full min-w-0 gap-0.5">
          {isVaultLoading ? (
            <FileTreeSkeleton />
          ) : fileTree.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No shards found in this vault.
            </p>
          ) : (
            fileTree.map((node) => <TreeNode key={node.path} node={node} />)
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
