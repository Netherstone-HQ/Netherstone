import {
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
} from "@platejs/basic-nodes";
import {
  BaseFontBackgroundColorPlugin,
  BaseFontColorPlugin,
  BaseFontFamilyPlugin,
  BaseFontSizePlugin,
  BaseLineHeightPlugin,
  BaseTextAlignPlugin,
} from "@platejs/basic-styles";
import { BaseCalloutPlugin } from "@platejs/callout";
import { BaseCaptionPlugin } from "@platejs/caption";
import { BaseCodeBlockPlugin } from "@platejs/code-block";
import { BaseCommentPlugin } from "@platejs/comment";
import { BaseDatePlugin } from "@platejs/date";
import { BaseIndentPlugin } from "@platejs/indent";
import { BaseColumnItemPlugin, BaseColumnPlugin } from "@platejs/layout";
import { BaseLinkPlugin } from "@platejs/link";
import { BaseListPlugin } from "@platejs/list";
import {
  BaseAudioPlugin,
  BaseFilePlugin,
  BaseImagePlugin,
  BasePlaceholderPlugin,
  BaseVideoPlugin,
} from "@platejs/media";
import { BaseMentionInputPlugin, BaseMentionPlugin } from "@platejs/mention";
import { BaseSuggestionPlugin } from "@platejs/suggestion";
import { BaseTablePlugin } from "@platejs/table";
import { BaseTocPlugin } from "@platejs/toc";
import { BaseTogglePlugin } from "@platejs/toggle";
import { KEYS, TrailingBlockPlugin, createSlatePlugin } from "platejs";

import { MarkdownKit } from "./kits/markdown-kit";

// `@platejs/math` imports KaTeX's CSS at module scope, which can't load in a
// worker. Markdown only needs the node definitions, mirrored from
// BaseEquationPlugin / BaseInlineEquationPlugin.
const EquationNodePlugin = createSlatePlugin({
  key: KEYS.equation,
  node: { isElement: true, isVoid: true },
});

const InlineEquationNodePlugin = createSlatePlugin({
  key: KEYS.inlineEquation,
  node: { isElement: true, isInline: true, isVoid: true },
});

/**
 * Serialization-specific plugin kit, used by the markdown worker.
 *
 * Mirrors the document schema of `EditorKit` with Plate's base (non-React)
 * plugins, so it loads in a worker: no UI components, no DOM access. Inject
 * targets must match the editor kits, since they decide which nodes carry
 * alignment, indent, list and font props through markdown.
 */
export const SerializationKit = [
  TrailingBlockPlugin,
  BaseTextAlignPlugin.configure({
    inject: {
      nodeProps: {
        defaultNodeValue: "start",
        nodeKey: "align",
        styleKey: "textAlign",
        validNodeValues: ["start", "left", "center", "right", "end", "justify"],
      },
      targetPlugins: [...KEYS.heading, KEYS.p, KEYS.img, KEYS.mediaEmbed],
    },
  }),
  BaseBasicBlocksPlugin,
  BaseBasicMarksPlugin,
  BaseCalloutPlugin,
  BaseCodeBlockPlugin,
  BaseColumnPlugin,
  BaseColumnItemPlugin,
  BaseCommentPlugin,
  BaseDatePlugin,
  BaseFontColorPlugin.configure({
    inject: { targetPlugins: [KEYS.p], nodeProps: { defaultNodeValue: "black" } },
  }),
  BaseFontBackgroundColorPlugin.configure({ inject: { targetPlugins: [KEYS.p] } }),
  BaseFontSizePlugin.configure({ inject: { targetPlugins: [KEYS.p] } }),
  BaseFontFamilyPlugin.configure({ inject: { targetPlugins: [KEYS.p] } }),
  BaseLineHeightPlugin.configure({
    inject: {
      nodeProps: {
        defaultNodeValue: 1.5,
        validNodeValues: [1, 1.2, 1.5, 2, 3],
      },
      targetPlugins: [...KEYS.heading, KEYS.p],
    },
  }),
  BaseLinkPlugin,
  BaseIndentPlugin.configure({
    inject: {
      targetPlugins: [
        ...KEYS.heading,
        KEYS.p,
        KEYS.blockquote,
        KEYS.codeBlock,
        KEYS.toggle,
      ],
    },
    options: { offset: 24 },
  }),
  BaseListPlugin.configure({
    inject: {
      targetPlugins: [
        ...KEYS.heading,
        KEYS.p,
        KEYS.blockquote,
        KEYS.codeBlock,
        KEYS.toggle,
        KEYS.img,
      ],
    },
  }),
  ...MarkdownKit,
  EquationNodePlugin,
  InlineEquationNodePlugin,
  BaseImagePlugin.configure({ options: { disableUploadInsert: true } }),
  BaseVideoPlugin.configure({ options: { disableUploadInsert: true } }),
  BaseAudioPlugin.configure({ options: { disableUploadInsert: true } }),
  BaseFilePlugin.configure({ options: { disableUploadInsert: true } }),
  BasePlaceholderPlugin,
  BaseCaptionPlugin.configure({
    options: {
      query: {
        allow: [KEYS.img, KEYS.video, KEYS.audio, KEYS.file, KEYS.mediaEmbed],
      },
    },
  }),
  BaseMentionPlugin,
  BaseMentionInputPlugin,
  BaseSuggestionPlugin,
  BaseTablePlugin,
  BaseTocPlugin.configure({ options: { topOffset: 80 } }),
  BaseTogglePlugin,
];
