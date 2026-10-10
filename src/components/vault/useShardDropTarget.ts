import { useDrop } from "react-dnd";

import {
  SHARD_DRAG_TYPE,
  canMoveShardInto,
  type ShardDragItem,
} from "@/lib/shard-drag";

/**
 * Makes an element take shards dropped into `folderPath`. Folders nest, so
 * only the innermost one under the pointer reacts; dropping a shard on the
 * folder it's already in does nothing rather than falling through to a parent.
 */
export function useShardDropTarget(folderPath: string | null) {
  const [{ isOver, canDrop }, connect] = useDrop<
    ShardDragItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(
    () => ({
      accept: SHARD_DRAG_TYPE,
      canDrop: (item) =>
        !!folderPath && canMoveShardInto(item.path, folderPath),
      drop: (item, monitor) => {
        if (!folderPath || !monitor.isOver({ shallow: true })) return;
        // moveTo reports its own failures.
        item.moveTo(folderPath).catch(() => {});
      },
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [folderPath],
  );

  return { connect, isOver, isDropTarget: isOver && canDrop };
}
