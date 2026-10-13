import { useDrop } from "react-dnd";

import {
  TREE_DRAG_TYPE,
  canMoveInto,
  type TreeDragItem,
} from "@/lib/tree-drag";

/**
 * Makes an element take shards and folders dropped into `folderPath`. Folders
 * nest, so only the innermost one under the pointer reacts; dropping on a
 * folder that can't take the item does nothing rather than falling through
 * to a parent.
 */
export function useTreeDropTarget(folderPath: string | null) {
  const [{ isOver, canDrop }, connect] = useDrop<
    TreeDragItem,
    void,
    { isOver: boolean; canDrop: boolean }
  >(
    () => ({
      accept: TREE_DRAG_TYPE,
      canDrop: (item) => !!folderPath && canMoveInto(item.path, folderPath),
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
