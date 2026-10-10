import { isSamePath } from "@/lib/drawing-files";

/** react-dnd item type for a shard dragged around the sidebar tree. */
export const SHARD_DRAG_TYPE = "vault-shard";

/** How long a dragged shard rests on a closed folder before it opens. */
export const EXPAND_ON_HOVER_MS = 600;

export interface ShardDragItem {
  path: string;
  /** Moves the shard into `folderPath`, the same way the Move dialog does. */
  moveTo: (folderPath: string) => Promise<void>;
}

export function getParentFolder(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const slash = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return slash === -1 ? "" : trimmed.slice(0, slash);
}

/** A shard can go into any folder except the one it's already in. */
export function canMoveShardInto(shardPath: string, folderPath: string) {
  return !isSamePath(getParentFolder(shardPath), folderPath);
}
