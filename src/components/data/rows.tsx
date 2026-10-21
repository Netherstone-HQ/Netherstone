import { openEditorFile } from "@/lib/open-editor-file";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";

export const LIST_ROW_CLASS =
  "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left text-ui outline-none transition-colors";
export const LINK_ROW_CLASS = cn(
  LIST_ROW_CLASS,
  "hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
);
/** The rounded list the Overview page's rows sit in. */
export const LIST_CLASS = "flex flex-col rounded-lg border bg-card p-1.5";

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

/** A row's own action, drawn like its Open label. */
export const ROW_ACTION_CLASS =
  "shrink-0 rounded-lg px-3 py-2 text-chart-4 text-ui-sm outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 dark:text-chart-2";

export function OpenLabel() {
  return (
    <span className="ml-auto shrink-0 text-chart-4 text-ui-sm dark:text-chart-2">
      Open
    </span>
  );
}
