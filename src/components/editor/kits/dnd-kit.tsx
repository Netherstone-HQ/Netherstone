"use client";

import { DndPlugin } from "@platejs/dnd";

import { toast } from "sonner";

import { insertManagedMediaFiles } from "@/components/editor/lib/media-insert";
import { BlockDraggable } from "@/components/ui/block-draggable";

export const DndKit = [
  DndPlugin.configure({
    options: {
      enableScroller: true,
      onDropFiles: ({ dragItem, editor, target }) => {
        const files = dragItem?.files;

        console.debug("[dnd-kit] Handling dropped media files", {
          fileCount: files?.length ?? 0,
          files: Array.from(files ?? []).map((file) => ({
            name: file.name,
            size: file.size,
            type: file.type,
          })),
          target,
        });

        void insertManagedMediaFiles(editor, files, {
          at: target ?? undefined,
          debug: true,
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
      aboveNodes: BlockDraggable,
    },
  }),
];
