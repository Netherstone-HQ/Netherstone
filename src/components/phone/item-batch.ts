import { toast } from "sonner";
import { deleteItem, moveItem } from "@/components/vault/item-actions";
import { isSamePath } from "@/lib/drawing-files";
import { useSettingsStore, useUIStore, useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";
import { usePhoneNav } from "./nav";
import { rememberedOf, showMovedToTrash } from "./trash";
import { findNodes } from "./vault-tree";

// Pin, move and trash for one row or several picked shards. Each closes
// select mode (or the row's menu) when it's done.

function nodesOf(paths: string[]): FileTreeNode[] {
  return findNodes(useVaultStore.getState().fileTree, paths);
}

/** The overlays a row action can open, closed together when it's done. */
const ACTION_KINDS = new Set<string>([
  "select",
  "row-menu",
  "shard-menu",
  "rename",
  "move",
  "confirm-trash",
]);

/** Closes select mode, or a row's menu and what it opened. */
export function closeActions() {
  const { entries, closeFrom } = usePhoneNav.getState();
  const first = entries.find((entry) => ACTION_KINDS.has(entry.kind));
  if (first) closeFrom(first.kind);
}

function reportFailure(what: string, error: unknown) {
  toast.error(what, {
    description: error instanceof Error ? error.message : String(error),
  });
}

/** Whether every one of `paths` is pinned. */
export function allPinned(pinned: { path: string }[], paths: string[]) {
  return (
    paths.length > 0 &&
    paths.every((path) => pinned.some((entry) => isSamePath(entry.path, path)))
  );
}

/** Pins `paths`, or unpins them when they all are already. */
export function pinAll(paths: string[]) {
  const { pinnedFiles, togglePinnedFile } = useUIStore.getState();
  const unpin = allPinned(pinnedFiles, paths);
  for (const node of nodesOf(paths)) {
    const isPinned = pinnedFiles.some((entry) =>
      isSamePath(entry.path, node.path),
    );
    if (isPinned === unpin)
      togglePinnedFile({ path: node.path, name: node.name });
  }
  closeActions();
}

/** Moves `paths` into `destination`, one at a time, stopping at a failure. */
export async function moveAll(paths: string[], destination: string) {
  try {
    for (const node of nodesOf(paths)) await moveItem(node, destination);
  } catch (error) {
    reportFailure("Couldn't move", error);
  }
  closeActions();
}

/** Moves `paths` to the trash, asking first when Settings says to. */
export function trashAll(paths: string[]) {
  if (useSettingsStore.getState().confirmBeforeDelete) {
    const { entries, push, replace } = usePhoneNav.getState();
    // From a menu the question takes the menu's place.
    const top = entries[entries.length - 1]?.kind;
    const open = top === "row-menu" || top === "shard-menu" ? replace : push;
    open({ kind: "confirm-trash", paths });
  } else {
    void runTrash(paths);
  }
}

/** Moves `paths` to the trash without asking, with Undo after. */
export async function runTrash(paths: string[]) {
  const trashed: string[] = [];
  const remembered = rememberedOf(paths);
  try {
    for (const node of nodesOf(paths)) {
      const id = await deleteItem(node);
      if (id) trashed.push(id);
    }
  } catch (error) {
    reportFailure("Couldn't move to trash", error);
  }
  closeActions();
  showMovedToTrash(trashed, remembered);
}
