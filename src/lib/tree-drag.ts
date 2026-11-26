import { getParentFolder, isPathWithin, isSamePath } from "@/lib/drawing-files";

/** react-dnd item type for a shard or folder dragged around the sidebar tree. */
export const TREE_DRAG_TYPE = "vault-entry";

/** How long a dragged item rests on a closed folder before it opens. */
export const EXPAND_ON_HOVER_MS = 600;

export interface TreeDragItem {
  path: string;
  /** Moves the item into `folderPath`, the same way the Move dialog does. */
  moveTo: (folderPath: string) => Promise<void>;
}

/**
 * A shard or folder can go into any folder except the one it's already in,
 * and a folder can't go into itself or anything inside it.
 */
export function canMoveInto(path: string, folderPath: string) {
  return (
    !isSamePath(getParentFolder(path), folderPath) &&
    !isPathWithin(folderPath, path)
  );
}
