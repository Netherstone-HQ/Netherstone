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

import {
  DARK_SOURCE_ATTRIBUTE,
  DRAWING_LINK_ATTRIBUTE,
} from "@/lib/drawing-files";
import { emptyLineRules } from "@/lib/markdown-empty-lines";
import { textHandler } from "@/lib/markdown-escapes";
import { rawBlockRules } from "@/lib/markdown-raw-blocks";
import { listGroupRules } from "@/lib/markdown-list-blocks";
import { shardLinkRules } from "@/lib/markdown-shard-links";
import { tableRules } from "@/lib/markdown-tables";
import { toggleRules } from "@/lib/markdown-toggles";
import { remarkLiteralMdxExpressions } from "@/lib/remark-literal-mdx-expressions";

/**
 * Plate saves images as `![alt](src)`, which has no room for a width. An
 * image that was resized, or that links back to the drawing it was exported
 * from (with its dark export), is saved as an `<img>` tag instead, which
 * Markdown renderers show at that width.
 */
const imageRule: MdRules["img"] = {
  deserialize: defaultRules.img?.deserialize,
  serialize: (node, options) => {
    const drawing = (node as Record<string, unknown>)[DRAWING_LINK_ATTRIBUTE];
    const hasDrawing = typeof drawing === "string" && drawing.length > 0;
    const darkSrc = (node as Record<string, unknown>)[DARK_SOURCE_ATTRIBUTE];
    const hasDarkSrc = typeof darkSrc === "string" && darkSrc.length > 0;
    const width =
      typeof node.width === "number" && node.width > 0 ? Math.round(node.width) : null;

    if (!hasDrawing && !hasDarkSrc && width === null) {
      return defaultRules.img!.serialize!(node, options);
    }

    const alt = node.caption?.map((child) => child.text).join("") ?? "";

    return {
      type: "mdxJsxFlowElement",
      name: "img",
      attributes: propsToAttributes({
        src: node.url,
        ...(hasDarkSrc ? { [DARK_SOURCE_ATTRIBUTE]: darkSrc } : {}),
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
      // Match common markdown style (and most hand-written notes): `-` for
      // bullets and `---` for rules, instead of remark's `*` defaults.
      // Text is escaped only where Markdown needs it (`markdown-escapes.ts`).
      remarkStringifyOptions: {
        bullet: "-",
        rule: "-",
        handlers: { text: textHandler },
      },
      rules: {
        img: imageRule,
        ...toggleRules,
        ...emptyLineRules,
        ...listGroupRules,
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
