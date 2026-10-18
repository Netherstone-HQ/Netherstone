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
import { emptyLineRules } from "@/lib/markdown-empty-lines";
import { rawBlockRules } from "@/lib/markdown-raw-blocks";
import { shardLinkRules } from "@/lib/markdown-shard-links";
import { tableRules } from "@/lib/markdown-tables";
import { toggleRules } from "@/lib/markdown-toggles";
import { remarkLiteralMdxExpressions } from "@/lib/remark-literal-mdx-expressions";

/**
 * Plate saves images as `![alt](src)`, which has no room for a width. An
 * image that was resized, or that links back to the drawing it was exported
 * from, is saved as an `<img>` tag instead, which Markdown renderers show
 * at that width.
 */
const imageRule: MdRules["img"] = {
  deserialize: defaultRules.img?.deserialize,
  serialize: (node, options) => {
    const drawing = (node as Record<string, unknown>)[DRAWING_LINK_ATTRIBUTE];
    const hasDrawing = typeof drawing === "string" && drawing.length > 0;
    const width =
      typeof node.width === "number" && node.width > 0 ? Math.round(node.width) : null;

    if (!hasDrawing && width === null) {
      return defaultRules.img!.serialize!(node, options);
    }

    const alt = node.caption?.map((child) => child.text).join("") ?? "";

    return {
      type: "mdxJsxFlowElement",
      name: "img",
      attributes: propsToAttributes({
        src: node.url,
        ...(alt ? { alt } : {}),
        ...(width !== null ? { width: String(width) } : {}),
        ...(hasDrawing ? { [DRAWING_LINK_ATTRIBUTE]: drawing } : {}),
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
      rules: {
        img: imageRule,
        ...toggleRules,
        ...emptyLineRules,
        ...rawBlockRules,
        ...shardLinkRules,
        ...tableRules,
      },
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
