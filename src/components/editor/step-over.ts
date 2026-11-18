import {
  PointApi,
  type Point,
  type SlateEditor,
  type TRange,
} from "platejs";

/**
 * The arrow keys step over an inline chip (an @ link, an inline equation, a
 * date) in one press, Shift+arrows too. The browser can't show a caret inside
 * one: it moves it to the top of the shard, and the next key lands there.
 */
export const stepOver = ({
  editor,
  tf: { move },
  type,
}: {
  editor: SlateEditor;
  tf: Pick<SlateEditor["tf"], "move">;
  type: string;
}) => {
  const inChip = (point: Point) =>
    !!editor.api.above({ at: point, match: { type } });
  // Whether a point the move changed ended up inside the chip.
  const movedIn = (before: TRange, after: TRange) =>
    (!PointApi.equals(before.anchor, after.anchor) && inChip(after.anchor)) ||
    (!PointApi.equals(before.focus, after.focus) && inChip(after.focus));

  return {
    transforms: {
      move(options?: Parameters<typeof move>[0]) {
        let before = editor.selection;
        move(options);
        while (before && editor.selection && movedIn(before, editor.selection)) {
          before = editor.selection;
          move(options);
        }
      },
    },
  };
};
