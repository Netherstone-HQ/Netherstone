import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { create } from "zustand";
import {
  CheckIcon,
  FileTextIcon,
  FolderIcon,
  PinIcon,
  PinOffIcon,
  TrashIcon,
} from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import { Dot } from "@/components/ui/dot";
import type { ShardPreview } from "@/lib/commands/shards";
import {
  displayNameOf,
  isDrawingPath,
  isSamePath,
  pathKey,
} from "@/lib/drawing-files";
import { formatModified } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { useUIStore, type FileTreeNode } from "@/store";
import { pinAll, trashAll } from "./item-batch";
import { openFileScreen } from "./open-file";
import { usePhoneNav, useSelecting } from "./nav";
import { usePhoneSelection } from "./selection";
import { countFiles, fileKindLabel } from "./vault-tree";

/** How far a finger moves sideways before a row follows it, in px. */
const DRAG_SLOP_PX = 8;

/** The row whose swipe actions are showing; one at a time. */
const useOpenSwipe = create<{
  path: string | null;
  setPath: (path: string | null) => void;
}>((set) => ({ path: null, setPath: (path) => set({ path }) }));

/** A row that slides left to show `actions`; a tap slides it back. */
function SwipeRow({
  path,
  actions,
  children,
}: {
  path: string;
  actions: ReactNode;
  children: ReactNode;
}) {
  const isOpen = useOpenSwipe((s) => s.path === path);
  const setOpenPath = useOpenSwipe((s) => s.setPath);
  const actionsRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  // A drag ends in a click on the row; this keeps that click from opening it.
  const justDragged = useRef(false);
  const [dragOffset, setDragOffset] = useState<number | null>(null);

  const width = () => actionsRef.current?.offsetWidth ?? 0;
  const offset = dragOffset ?? (isOpen ? -width() : 0);

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    justDragged.current = false;
    drag.current = { x: event.clientX, from: offset, moved: false };
  };
  const onPointerMove = (event: PointerEvent) => {
    const start = drag.current;
    if (!start) return;
    const dx = event.clientX - start.x;
    if (!start.moved) {
      if (Math.abs(dx) < DRAG_SLOP_PX) return;
      start.moved = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragOffset(Math.min(0, Math.max(-width(), start.from + dx)));
  };
  const onPointerEnd = () => {
    const start = drag.current;
    drag.current = null;
    if (!start?.moved || dragOffset === null) return;
    justDragged.current = true;
    if (dragOffset < -width() / 2) setOpenPath(path);
    else if (isOpen) setOpenPath(null);
    setDragOffset(null);
  };

  return (
    <div className="relative overflow-hidden">
      <div
        ref={actionsRef}
        aria-hidden={!isOpen}
        inert={!isOpen}
        className={cn(
          "absolute inset-y-0 right-0 flex",
          // Hidden while closed, so no edge of it shows past the row.
          !isOpen && dragOffset === null && "invisible",
        )}
      >
        {actions}
      </div>
      <div
        className={cn(
          "relative touch-pan-y bg-background",
          dragOffset === null && "transition-transform",
        )}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={() => {
          drag.current = null;
          setDragOffset(null);
        }}
        onClickCapture={(event) => {
          if (justDragged.current) {
            justDragged.current = false;
            event.stopPropagation();
          } else if (isOpen) {
            event.stopPropagation();
            setOpenPath(null);
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}

function SwipeAction({
  label,
  icon,
  danger,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  onClick: () => void;
}) {
  const setOpenPath = useOpenSwipe((s) => s.setPath);
  return (
    <button
      type="button"
      className={cn(
        "flex w-20 flex-col items-center justify-center gap-1.5 text-sm outline-none [&_svg]:size-5",
        danger ? "bg-destructive text-white" : "bg-accent",
      )}
      onClick={() => {
        setOpenPath(null);
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );
}

/** The box a row shows in its icon's place while picking. */
export function SelectBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded-md border-[1.5px]",
        checked
          ? "border-brand bg-brand text-background"
          : "border-muted-foreground",
      )}
    >
      {checked ? <CheckIcon className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

/** A shard or drawing. Swipe left for Pin and Delete, hold for its menu. */
export function FileRow({
  path,
  detail,
  preview,
  onOpen = openFileScreen,
}: {
  path: string;
  /** The folder it's in; without it the row shows the file's first line. */
  detail?: string;
  preview: ShardPreview | undefined;
  /** Opens it some other way than at its top. */
  onOpen?: (path: string) => Promise<void>;
}) {
  const push = usePhoneNav((s) => s.push);
  const selecting = useSelecting();
  const checked = usePhoneSelection((s) => s.keys.has(pathKey(path)));
  const toggle = usePhoneSelection((s) => s.toggle);
  const isPinned = useUIStore((s) =>
    s.pinnedFiles.some((entry) => isSamePath(entry.path, path)),
  );

  const Icon = isDrawingPath(path) ? DrawingIcon : FileTextIcon;
  const second = detail ?? preview?.preview ?? fileKindLabel(path) ?? undefined;
  const date =
    preview?.lastModified != null ? formatModified(preview.lastModified) : null;

  const row = (
    <button
      type="button"
      role={selecting ? "checkbox" : undefined}
      aria-checked={selecting ? checked : undefined}
      className={cn(
        "flex min-h-16 w-full flex-col justify-center gap-0.5 px-4 text-left outline-none select-none active:bg-accent",
        selecting && checked && "bg-card",
      )}
      onClick={() => (selecting ? toggle(path) : void onOpen(path))}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!selecting) push({ kind: "row-menu", path });
      }}
    >
      <span className="flex w-full min-w-0 items-center gap-3">
        {selecting ? (
          <SelectBox checked={checked} />
        ) : (
          <Icon className="size-5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">
          {displayNameOf(path)}
        </span>
      </span>
      {date || second ? (
        <span className="flex w-full min-w-0 items-center gap-2 pl-8 text-sm leading-5 text-muted-foreground">
          {date ? <span className="shrink-0">{date}</span> : null}
          {date && second ? <Dot className="mx-0" /> : null}
          {second ? <span className="min-w-0 truncate">{second}</span> : null}
        </span>
      ) : null}
    </button>
  );

  if (selecting) return row;
  return (
    <SwipeRow
      path={path}
      actions={
        <>
          <SwipeAction
            label={isPinned ? "Unpin" : "Pin"}
            icon={isPinned ? <PinOffIcon /> : <PinIcon />}
            onClick={() => pinAll([path])}
          />
          <SwipeAction
            danger
            label="Delete"
            icon={<TrashIcon />}
            onClick={() => trashAll([path])}
          />
        </>
      }
    >
      {row}
    </SwipeRow>
  );
}

/** A folder, with how many files are inside it. Press and hold for its menu. */
export function FolderRow({ folder }: { folder: FileTreeNode }) {
  const push = usePhoneNav((s) => s.push);
  return (
    <button
      type="button"
      className="flex h-14 w-full items-center gap-3 px-4 text-left outline-none select-none active:bg-accent"
      onClick={() => push({ kind: "folder", path: folder.path })}
      onContextMenu={(event) => {
        event.preventDefault();
        push({ kind: "row-menu", path: folder.path });
      }}
    >
      <FolderIcon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      <span className="text-sm text-muted-foreground">
        {countFiles(folder)}
      </span>
    </button>
  );
}
