import type { TElement } from "platejs";
import { useEditorSelector } from "platejs/react";

type Options<T> = {
  defaultValue?: T;
  getProp: (node: TElement) => T | undefined;
};

/**
 * A property shared by the blocks the selection touches, for a toolbar
 * button that shows the current alignment or line height.
 *
 * Plate's `useSelectionFragmentProp` copies the whole document on every
 * change to cut the selection out of it, which in a long shard costs more
 * than the keystroke itself; the blocks at the selection are enough.
 */
export function useSelectionBlockProp<T>({ defaultValue, getProp }: Options<T>) {
  return useEditorSelector(
    (editor) => {
      if (!editor.selection) return defaultValue;
      const blocks = Array.from(editor.api.blocks({ mode: "lowest" }));
      if (blocks.length === 0) return defaultValue;
      // Plate types the shared value as a string; the buttons read numbers too.
      return editor.api.prop({
        defaultValue: defaultValue as unknown as string,
        getProp: (node) => getProp(node as TElement) as unknown as string,
        nodes: blocks.map(([node]) => node),
      }) as T | undefined;
    },
    [defaultValue, getProp],
  );
}
