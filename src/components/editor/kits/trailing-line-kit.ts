import { createSlatePlugin, KEYS, nanoid } from "platejs";
import { isBlankParagraph } from "@/lib/editor-markdown";

/**
 * Keeps an empty line at the end of every shard, so there is always somewhere
 * to type below a table, code block or image, and the editor never ends up
 * with no blocks at all (deleting every selected block would otherwise leave
 * nothing to type into). Saving drops it, so it never reaches the file.
 */
export const TrailingLinePlugin = createSlatePlugin({
  key: "trailingLine",
  transformInitialValue: ({ editor, value }) =>
    isBlankParagraph(value.at(-1))
      ? value
      : [
          ...value,
          // Inserted blocks get an id from NodeIdPlugin, but this one isn't
          // inserted. Without an id, block selection can't select it.
          { ...editor.api.create.block({ type: KEYS.p }), id: nanoid(10) },
        ],
}).overrideEditor(({ editor, tf: { normalizeNode } }) => ({
  transforms: {
    normalizeNode(entry) {
      if (entry[1].length === 0 && !isBlankParagraph(editor.children.at(-1))) {
        editor.tf.insertNodes(editor.api.create.block({ type: KEYS.p }), {
          at: [editor.children.length],
        });
        return;
      }

      normalizeNode(entry);
    },
  },
}));

export const TrailingLineKit = [TrailingLinePlugin];
