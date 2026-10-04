import { FolderSimpleIcon, NoteIcon, ScribbleIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getVaultFileDisplayName, isDrawingPath } from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import { useEditorStore, useUIStore } from "@/store";
import type { FileTreeNode } from "@/store";

type CollapsedNodeProps = {
  node: FileTreeNode;
};

export function CollapsedNode({ node }: CollapsedNodeProps) {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);

  const isFile = node.kind === "file";
  const displayName = isFile ? getVaultFileDisplayName(node.name) : node.name;

  const handleClick = async () => {
    if (!isFile) return;

    try {
      await openVaultFile(node.path);
      setActiveNavItem(null);
    } catch (error) {
      console.error("Failed to load file:", error);
    }
  };

  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={isFile ? handleClick : undefined}
            className={cn(
              "h-8 w-full",
              isFile && node.path === currentFilePath && "bg-accent",
            )}
            aria-label={displayName}
            title={displayName}
          >
            {isFile && isDrawingPath(node.path) ? (
              <ScribbleIcon className="h-4 w-4" />
            ) : isFile ? (
              <NoteIcon className="h-4 w-4" />
            ) : (
              <FolderSimpleIcon className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{displayName}</TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}
