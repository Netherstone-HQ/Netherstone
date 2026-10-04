import {
  defaultRules,
  MarkdownPlugin,
  propsToAttributes,
  remarkMdx,
  remarkMention,
  type MdRules,
} from "@platejs/markdown";
import { KEYS } from "platejs";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { DRAWING_LINK_ATTRIBUTE } from "@/lib/drawing-files";
import { remarkLiteralMdxExpressions } from "@/lib/remark-literal-mdx-expressions";

/**
 * Images exported from a canvas link back to their drawing. Plate saves
 * images as `![alt](src)`, which would drop that link (and the width), so
 * linked images are saved as `<img>` tags instead.
 */
const imageRule: MdRules["img"] = {
  deserialize: defaultRules.img?.deserialize,
  serialize: (node, options) => {
    const drawing = (node as Record<string, unknown>)[DRAWING_LINK_ATTRIBUTE];

    if (typeof drawing !== "string" || drawing.length === 0) {
      return defaultRules.img!.serialize!(node, options);
    }

    const alt = node.caption?.map((child) => child.text).join("") ?? "";

    return {
      type: "mdxJsxFlowElement",
      name: "img",
      attributes: propsToAttributes({
        src: node.url,
        ...(alt ? { alt } : {}),
        ...(node.width != null ? { width: node.width } : {}),
        [DRAWING_LINK_ATTRIBUTE]: drawing,
      }),
      children: [],
    } as never;
  },
};

export const MarkdownKit = [
  MarkdownPlugin.configure({
    options: {
      plainMarks: [KEYS.suggestion, KEYS.comment],
      // Match common markdown style (and most hand-written notes): `-` for
      // bullets and `---` for rules, instead of remark's `*` defaults.
      remarkStringifyOptions: { bullet: "-", rule: "-" },
      rules: { img: imageRule },
      remarkPlugins: [
        remarkMath,
        remarkGfm,
        remarkMdx,
        remarkLiteralMdxExpressions,
        remarkMention,
      ],
    },
  }),
];
