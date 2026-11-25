import { create } from "zustand";
import { toast } from "sonner";
import {
  deleteAppTrash,
  listAppTrash,
  restoreAppTrash,
  type TrashedItem,
} from "@/lib/commands/trash";
import { isPathWithin } from "@/lib/drawing-files";
import { refreshVault } from "@/lib/refresh-vault";
import { useUIStore, useVaultStore } from "@/store";
import type { RecentFileEntry } from "@/store/ui";

// The app's trash on a phone: what's in it from the open vault, and
// bringing things back or deleting them for good.

interface TrashState {
  items: TrashedItem[];
  /** False until the first load, so an empty list isn't shown too early. */
  loaded: boolean;
  /** Reads what's in the trash again. */
  load: () => Promise<void>;
}

export const useAppTrash = create<TrashState>((set) => ({
  items: [],
  loaded: false,
  load: async () => {
    try {
      set({ items: await listAppTrash(), loaded: true });
    } catch (error) {
      console.error("[Netherstone] Couldn't read the trash:", error);
      set({ loaded: true });
    }
  },
}));

function reportFailure(what: string, error: unknown) {
  toast.error(what, {
    description: error instanceof Error ? error.message : String(error),
  });
}

/** Puts `ids` back in the vault, then shows them there. Returns where they went. */
export async function restoreTrashed(ids: string[]): Promise<string[]> {
  let restored: string[] = [];
  try {
    restored = await restoreAppTrash(ids);
  } catch (error) {
    reportFailure("Couldn't restore", error);
  }
  await refreshVault(useVaultStore.getState().currentVaultPath);
  await useAppTrash.getState().load();
  return restored;
}

/** Recent and pinned files at or inside some paths, each with its place. */
interface Remembered {
  recent: [number, RecentFileEntry][];
  pinned: [number, RecentFileEntry][];
}

/** What home remembers at or inside `paths`, before they go to the trash. */
export function rememberedOf(paths: string[]): Remembered {
  const { recentFiles, pinnedFiles } = useUIStore.getState();
  const within = (entries: RecentFileEntry[]) =>
    entries
      .map((entry, at): [number, RecentFileEntry] => [at, entry])
      .filter(([, entry]) => paths.some((path) => isPathWithin(entry.path, path)));
  return { recent: within(recentFiles), pinned: within(pinnedFiles) };
}

/**
 * Puts entries of `saved` back in their places, for the files that came
 * back where they were.
 */
function putBack(saved: Remembered, restored: string[]) {
  const back = (entry: RecentFileEntry) =>
    restored.some((path) => isPathWithin(entry.path, path));
  const merge = (entries: RecentFileEntry[], kept: [number, RecentFileEntry][]) => {
    const next = [...entries];
    for (const [at, entry] of kept) {
      if (back(entry) && !next.some((other) => other.path === entry.path))
        next.splice(Math.min(at, next.length), 0, entry);
    }
    return next;
  };
  useUIStore.setState((state) => ({
    recentFiles: merge(state.recentFiles, saved.recent),
    pinnedFiles: merge(state.pinnedFiles, saved.pinned),
  }));
}

/** Deletes `ids` for good. */
export async function deleteTrashedForever(ids: string[]) {
  try {
    await deleteAppTrash(ids);
  } catch (error) {
    reportFailure("Couldn't delete", error);
  }
  await useAppTrash.getState().load();
}

/** How long a toast offering Undo stays, in ms. */
export const UNDO_TOAST_MS = 8000;
/** One "Moved to Trash" toast at a time: the newest delete's. */
const UNDO_TOAST_ID = "moved-to-trash";

/** Takes the "Moved to Trash" toast away, once the Trash itself is open. */
export function dismissMovedToTrash() {
  toast.dismiss(UNDO_TOAST_ID);
}

/**
 * Says that `ids` went to the trash, with Undo to bring them back and put
 * what home remembered of them back in place.
 */
export function showMovedToTrash(ids: string[], remembered: Remembered) {
  if (ids.length === 0) return;
  const undo = async () => putBack(remembered, await restoreTrashed(ids));
  toast("Moved to Trash", {
    id: UNDO_TOAST_ID,
    duration: UNDO_TOAST_MS,
    action: { label: "Undo", onClick: () => void undo() },
  });
  void useAppTrash.getState().load();
}

const DAY_MS = 86_400_000;
/** Up to this many days ago, a deletion says how many days. */
const DAYS_SHOWN_AS_COUNT = 6;

/**
 * When an item was deleted, as its row says it: "Deleted today", "Deleted
 * yesterday", "Deleted 3 days ago", then the date.
 */
export function deletedLabel(deletedAt: number, now = new Date()): string {
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const date = new Date(deletedAt);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return "Deleted today";
  if (days === 1) return "Deleted yesterday";
  if (days <= DAYS_SHOWN_AS_COUNT) return `Deleted ${days} days ago`;
  const shown = date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
  return `Deleted ${shown}`;
}

/**
 * The folder an item was in, inside `vault`, as its row shows it: the
 * vault's own name at the top.
 */
export function folderOf(from: string, vault: string): string {
  const parts = (path: string) => path.split(/[\\/]+/).filter(Boolean);
  const vaultParts = parts(vault);
  const inside = parts(from).slice(vaultParts.length, -1);
  return inside.length > 0
    ? inside.join("/")
    : (vaultParts[vaultParts.length - 1] ?? "");
}
