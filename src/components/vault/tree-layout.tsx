// Shared geometry and look for file rows: the vault tree, Pinned and Recent.

import { ChevronRightIcon } from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import { isDrawingPath } from "@/lib/drawing-files";
import { cn } from "@/lib/utils";

/** A file row. Add ACTIVE_ROW_CLASS for the open file. */
export const ROW_CLASS =
  "flex h-row w-full min-w-0 items-center gap-1 rounded-sm pr-1 text-ui text-sidebar-foreground/85 transition-colors hover:bg-accent/40 has-[button:focus-visible]:bg-accent/40 data-[state=open]:bg-accent/40";
export const ACTIVE_ROW_CLASS =
  "bg-accent text-accent-foreground hover:bg-accent";
// Rows draw their own hover and focus; the button inside only takes clicks.
export const ROW_BUTTON_CLASS =
  "flex h-full min-w-0 flex-1 cursor-default items-center gap-1 text-left outline-none";

export const MAX_INDENT_DEPTH = 6;
const INDENT_STEP_PX = 16;
const BASE_INDENT_PX = 6;
export const DISCLOSURE_SLOT_PX = 16;
export const ACTION_SLOT_PX = 24;

export function getRowIndent(depth: number) {
  return BASE_INDENT_PX + depth * INDENT_STEP_PX;
}

export function getGuideLeft(depth: number) {
  return getRowIndent(depth) + DISCLOSURE_SLOT_PX / 2;
}

/**
 * The fixed slot before a row's name: a folder's chevron, or the drawing
 * mark, so every name in a level starts at the same place.
 */
export function RowSlot({ children }: { children?: React.ReactNode }) {
  return (
    <span
      className="flex h-4 shrink-0 items-center justify-center"
      style={{ width: `${DISCLOSURE_SLOT_PX}px` }}
    >
      {children}
    </span>
  );
}

/** A file's slot: the drawing mark for drawings, empty for shards. */
export function FileSlot({ path }: { path: string }) {
  return (
    <RowSlot>
      {isDrawingPath(path) ? (
        <DrawingIcon
          role="img"
          aria-label="Drawing"
          className="size-4 text-muted-foreground"
        />
      ) : null}
    </RowSlot>
  );
}

export function FolderChevron({ isOpen }: { isOpen: boolean }) {
  return (
    <ChevronRightIcon
      className={cn(
        "size-3.5 text-muted-foreground transition-transform duration-150",
        isOpen && "rotate-90",
      )}
    />
  );
}

/** The indent guides of a row's ancestors. */
export function TreeGuides({ depth }: { depth: number }) {
  return Array.from({ length: Math.min(depth, MAX_INDENT_DEPTH) }, (_, i) => (
    <div
      key={i}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border/30"
      style={{ left: `${getGuideLeft(i)}px` }}
    />
  ));
}
