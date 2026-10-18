import { defaultRules, type MdRules } from "@platejs/markdown";
import { KEYS, type TElement } from "platejs";

/**
 * An empty line in the editor is saved as `<br>` on its own line, which
 * every Markdown renderer shows as a blank line, instead of the invisible
 * zero-width space Plate writes by default. Only paragraphs outside table
 * cells are marked; an empty cell stays empty.
 */

export const BLANK_LINE_PROP = "netherstoneBlankLine";

export const BLANK_LINE_HTML = "<br>";

/** A paragraph with no text that is not a list item. */
export function isEmptyParagraph(node: TElement): boolean {
  return (
    node.type === KEYS.p &&
    !node.listStyleType &&
    Array.isArray(node.children) &&
    node.children.every(
      (child) => typeof (child as { text?: unknown }).text === "string" && (child as { text: string }).text === "",
    )
  );
}

export const emptyLineRules: MdRules = {
  p: {
    deserialize: defaultRules.p!.deserialize,
    serialize: (node, options) => {
      if ((node as TElement)[BLANK_LINE_PROP]) {
        return { type: "html", value: BLANK_LINE_HTML } as never;
      }
      return defaultRules.p!.serialize!(node, options);
    },
  },
  br: {
    deserialize: (mdastNode, deco, options) => {
      // `<br>` on its own line is a blank line; inside text it is a line break.
      if (mdastNode.type === "mdxJsxFlowElement") {
        return { type: KEYS.p, children: [{ text: "" }] } as never;
      }
      return defaultRules.br!.deserialize!(mdastNode, deco, options);
    },
  },
};
