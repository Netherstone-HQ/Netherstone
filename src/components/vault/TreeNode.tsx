import { useEffect, useRef, useState } from "react";
import { useDrag } from "react-dnd";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar";
import { NewFolderRow } from "@/components/vault/NewFolderRow";
import { RowActionsButton, RowContextMenu } from "@/components/vault/RowActions";
import {
  ACTION_SLOT_PX,
  ACTIVE_ROW_CLASS,
  FileSlot,
  FolderChevron,
  MAX_INDENT_DEPTH,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  RowSlot,
  TreeGuides,
  getGuideLeft,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { useOpenFilePath } from "@/components/vault/useOpenFilePath";
import { useTreeDropTarget } from "@/components/vault/useTreeDropTarget";
import { useVaultItem } from "@/components/vault/useVaultItem";
import { isPathWithin, isSamePath } from "@/lib/drawing-files";
import {
  EXPAND_ON_HOVER_MS,
  TREE_DRAG_TYPE,
  type TreeDragItem,
} from "@/lib/tree-drag";
import { cn } from "@/lib/utils";
import { useUIStore, useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";

/** How long a folder revealed from the breadcrumb stays highlighted. */
const REVEAL_HIGHLIGHT_MS = 1200;

type TreeNodeProps = {
  node: FileTreeNode;
  depth?: number;
};

export function TreeNode({ node, depth = 0 }: TreeNodeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isRevealed, setIsRevealed] = useState(false);
  const rowButtonRef = useRef<HTMLButtonElement>(null);

  const openFilePath = useOpenFilePath();
  const newFolderParent = useVaultStore((s) => s.newFolderParent);
  // Only the folders on the way to a revealed folder see the reveal.
  const reveal = useUIStore((s) =>
    s.treeReveal && isPathWithin(s.treeReveal.path, node.path)
      ? s.treeReveal
      : null,
  );
  const endTreeReveal = useUIStore((s) => s.endTreeReveal);

  const item = useVaultItem(node, { onNewFolder: () => setIsOpen(true) });
  const { displayName, isRenaming } = item;

  // Shards and folders drag onto folders as a shortcut for the Move dialog.
  const [{ isDragging }, connectDrag] = useDrag<
    TreeDragItem,
    void,
    { isDragging: boolean }
  >(
    () => ({
      type: TREE_DRAG_TYPE,
      item: { path: node.path, moveTo: item.moveToFolder },
      canDrag: !isRenaming,
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }),
    [node.path, isRenaming, item.moveToFolder],
  );
  const drop = useTreeDropTarget(node.kind === "directory" ? node.path : null);

  // An item held over a closed folder opens it, so nested folders are reachable.
  useEffect(() => {
    if (!drop.isOver || isOpen) return;
    const timer = window.setTimeout(() => setIsOpen(true), EXPAND_ON_HOVER_MS);
    return () => window.clearTimeout(timer);
  }, [drop.isOver, isOpen]);

  // Folders open down to a revealed folder, which then shows itself. Each
  // one mounts as its parent opens, so this also runs on mount.
  useEffect(() => {
    if (!reveal || node.kind !== "directory") return;
    setIsOpen(true);
    if (!isSamePath(reveal.path, node.path)) return;

    rowButtonRef.current?.scrollIntoView({ block: "nearest" });
    rowButtonRef.current?.focus({ preventScroll: true });
    setIsRevealed(true);
    const timer = window.setTimeout(() => {
      setIsRevealed(false);
      endTreeReveal(reveal);
    }, REVEAL_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [reveal, node.kind, node.path, endTreeReveal]);

  const rowIndent = getRowIndent(depth);
  const showChildrenGuide =
    node.kind === "directory" && depth < MAX_INDENT_DEPTH;

  const renameInput = (
    <Input
      {...item.renameInputProps}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className="h-6 min-w-0 flex-1 px-2 py-0 text-ui"
    />
  );

  const slot =
    node.kind === "directory" ? (
      <RowSlot>
        <FolderChevron isOpen={isOpen} />
      </RowSlot>
    ) : (
      <FileSlot path={node.path} />
    );

  const name = (
    <span className="block min-w-0 flex-1 truncate">{displayName}</span>
  );

  const row = (
    <div
      className={cn(
        ROW_CLASS,
        node.kind === "file" &&
          !!openFilePath &&
          isSamePath(node.path, openFilePath) &&
          ACTIVE_ROW_CLASS,
        isRevealed && "bg-sidebar-primary/15",
      )}
      style={{ paddingLeft: `${rowIndent}px` }}
    >
      {isRenaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-left">
          {slot}
          {renameInput}
        </div>
      ) : node.kind === "directory" ? (
        <CollapsibleTrigger asChild>
          <button
            ref={rowButtonRef}
            type="button"
            className={ROW_BUTTON_CLASS}
          >
            {slot}
            {name}
          </button>
        </CollapsibleTrigger>
      ) : (
        <button
          type="button"
          onClick={() => void item.open()}
          className={ROW_BUTTON_CLASS}
        >
          {slot}
          {name}
        </button>
      )}

      {isRenaming ? (
        <span className="shrink-0" style={{ width: `${ACTION_SLOT_PX}px` }} />
      ) : (
        <RowActionsButton label={displayName} actions={item.actions} />
      )}
    </div>
  );

  const rowShell = (
    <div
      ref={(el) => {
        connectDrag(el);
      }}
      className={cn(
        "group/row relative w-full min-w-0 transition-opacity",
        isDragging && "opacity-40",
      )}
    >
      <TreeGuides depth={depth} />
      <RowContextMenu actions={item.actions} disabled={isRenaming}>
        {row}
      </RowContextMenu>
      {item.dialogs}
    </div>
  );

  if (node.kind === "file") {
    return (
      <SidebarMenuItem className="w-full min-w-0 overflow-hidden">
        {rowShell}
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem className="w-full min-w-0 overflow-hidden">
      <Collapsible
        ref={(el: HTMLDivElement | null) => {
          drop.connect(el);
        }}
        open={isOpen}
        onOpenChange={setIsOpen}
        className={cn(
          "rounded-sm transition-colors",
          drop.isDropTarget &&
            "bg-sidebar-accent/60 ring-1 ring-sidebar-ring/50 ring-inset",
        )}
      >
        {rowShell}

        <CollapsibleContent className="w-full min-w-0 overflow-hidden">
          <div className="relative w-full min-w-0 overflow-hidden">
            {showChildrenGuide ? (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border/30"
                style={{ left: `${getGuideLeft(depth)}px` }}
              />
            ) : null}

            <SidebarMenu className="w-full min-w-0 overflow-hidden">
              {newFolderParent === node.path ? (
                <NewFolderRow parent={node.path} depth={depth + 1} />
              ) : null}
              {node.children?.map((child) => (
                <TreeNode key={child.path} node={child} depth={depth + 1} />
              ))}
            </SidebarMenu>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  );
}
