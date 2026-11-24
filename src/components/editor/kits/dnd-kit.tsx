import * as React from "react";

import { DndPlugin, DndScroller } from "@platejs/dnd";
import { useEditorRef, usePluginOption } from "platejs/react";

import { toast } from "sonner";

import { insertManagedMediaFiles } from "@/components/editor/lib/media-insert";
import { BlockDraggable } from "@/components/ui/block-draggable";
import { IS_MOBILE } from "@/lib/platform";
import { findScrollableAncestor } from "@/lib/scroll-root";

/** Marks the edges, which come up a moment after a drag starts. */
const EDGE_PROPS: React.HTMLAttributes<HTMLDivElement> & { "data-drag-edge": string } = {
  "data-drag-edge": "",
};

/**
 * Scrolls the shard while a block is held at the top or bottom edge. Plate's
 * own scroller scrolls the window unless it's given the element that scrolls,
 * and the shard scrolls inside its own panel.
 */
function DragEdgeScroller() {
  const editor = useEditorRef();
  const isDragging = usePluginOption(DndPlugin, "isDragging");
  const containerRef = React.useRef<HTMLElement | null>(null);

  React.useLayoutEffect(() => {
    containerRef.current = isDragging
      ? findScrollableAncestor(editor.api.toDOMNode(editor) ?? null)
      : null;
  }, [editor, isDragging]);

  return <DndScroller containerRef={containerRef} scrollAreaProps={EDGE_PROPS} />;
}

export const DndKit = [
  DndPlugin.configure({
    options: {
      onDropFiles: ({ dragItem, editor, target }) => {
        const files = dragItem?.files;

        void insertManagedMediaFiles(editor, files, {
          at: target ?? undefined,
        }).catch((error) => {
          console.error("[dnd-kit] Failed to insert dropped files", {
            error,
            target,
          });

          toast.error("Failed to insert dropped files", {
            description:
              error instanceof Error ? error.message : "Unknown drop error.",
          });
        });
      },
    },
    render: {
      // No drag handles on a phone: blocks move from the long-press menu.
      aboveNodes: IS_MOBILE ? undefined : BlockDraggable,
      afterEditable: () => <DragEdgeScroller />,
    },
  }),
];
