import { openEditorFile } from "@/lib/open-editor-file";
import { cn } from "@/lib/utils";
import { useEditorStore, useUIStore } from "@/store";
import type { PendingReveal } from "@/store/editor";

export const LIST_ROW_CLASS =
  "flex w-full min-w-0 items-baseline gap-2 rounded-md px-2.5 py-1 text-left text-ui outline-none transition-colors";
export const LINK_ROW_CLASS = cn(
  LIST_ROW_CLASS,
  "hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
);
/** The muted label over a group of rows, with its count. */
export const GROUP_LABEL_CLASS =
  "flex h-8 items-center gap-1.5 px-2.5 text-muted-foreground text-ui-sm";

export function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** Opens `path` in the Editor; false if it couldn't be opened. */
export async function openShard(path: string): Promise<boolean> {
  try {
    await openEditorFile(path);
    useUIStore.getState().openMode("editor");
    return true;
  } catch (error) {
    console.error("[Netherstone] Failed to open shard from Overview:", error);
    return false;
  }
}

/** Opens the shard in `reveal`, scrolled to what it names. */
export async function openShardAt(reveal: PendingReveal) {
  const { setPendingLinkReveal } = useEditorStore.getState();
  setPendingLinkReveal(reveal);
  if (!(await openShard(reveal.path))) setPendingLinkReveal(null);
}

/**
 * A section of the Overview page. A list card holds rows, which line up
 * with its title.
 */
export function Card({
  title,
  aside,
  isList = false,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  /** Shown at the end of the title's line. */
  aside?: React.ReactNode;
  isList?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className={cn("min-w-0 rounded-lg border bg-card", className)}
    >
      <div
        className={cn(
          "flex h-full flex-col",
          isList ? "gap-1 px-1.5 pt-2.5 pb-1.5" : "gap-3 p-4 pt-3.5",
          bodyClassName,
        )}
      >
        <div
          className={cn(
            "flex items-baseline justify-between gap-3",
            isList && "px-2.5 pt-1 pb-1",
          )}
        >
          <h2 className="font-medium text-ui">{title}</h2>
          {aside ? (
            <span className="shrink-0 text-muted-foreground text-ui-sm tabular-nums">
              {aside}
            </span>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}
