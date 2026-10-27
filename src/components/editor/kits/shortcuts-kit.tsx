'use client';

import {
  BlockquotePlugin,
  BoldPlugin,
  CodePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HighlightPlugin,
  ItalicPlugin,
  StrikethroughPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react';
import { CodeBlockPlugin } from '@platejs/code-block/react';
import { ExitBreakPlugin, KEYS } from 'platejs';
import { createPlatePlugin, type PlateEditor } from 'platejs/react';

import { findShortcut, type ShortcutIdIn } from '@/lib/shortcuts';
import { useSettingsStore } from '@/store/settings';

/** What each editor shortcut does. False lets the keys through. */
const ACTIONS: Record<
  ShortcutIdIn<'editor'>,
  (editor: PlateEditor) => boolean | void
> = {
  bold: (editor) => editor.getTransforms(BoldPlugin).bold.toggle(),
  italic: (editor) => editor.getTransforms(ItalicPlugin).italic.toggle(),
  underline: (editor) =>
    editor.getTransforms(UnderlinePlugin).underline.toggle(),
  strikethrough: (editor) =>
    editor.getTransforms(StrikethroughPlugin).strikethrough.toggle(),
  code: (editor) => editor.getTransforms(CodePlugin).code.toggle(),
  highlight: (editor) =>
    editor.getTransforms(HighlightPlugin).highlight.toggle(),
  superscript: (editor) =>
    editor.getTransforms(SuperscriptPlugin).superscript.toggle(),
  subscript: (editor) =>
    editor.getTransforms(SubscriptPlugin).subscript.toggle(),
  heading1: (editor) => editor.getTransforms(H1Plugin).h1.toggle(),
  heading2: (editor) => editor.getTransforms(H2Plugin).h2.toggle(),
  heading3: (editor) => editor.getTransforms(H3Plugin).h3.toggle(),
  heading4: (editor) => editor.getTransforms(H4Plugin).h4.toggle(),
  heading5: (editor) => editor.getTransforms(H5Plugin).h5.toggle(),
  heading6: (editor) => editor.getTransforms(H6Plugin).h6.toggle(),
  paragraph: (editor) => editor.tf.toggleBlock(editor.getType(KEYS.p)),
  quote: (editor) =>
    editor.getTransforms(BlockquotePlugin).blockquote.toggle(),
  codeBlock: (editor) =>
    editor.getTransforms(CodeBlockPlugin).code_block.toggle(),
  newLineAfter: (editor) =>
    editor.getTransforms(ExitBreakPlugin).exitBreak.insert({}),
  newLineBefore: (editor) =>
    editor.getTransforms(ExitBreakPlugin).exitBreak.insertBefore({}),
};

/**
 * The editor's shortcuts, on whatever keys Settings › Shortcuts has for
 * them. Plate's own key handling is off in every kit, so these are the only
 * keys the editor takes. First in the editor kit, so they run before other
 * key handling, as Plate's did.
 */
export const ShortcutsKit = [
  createPlatePlugin({
    key: 'shortcuts',
    handlers: {
      onKeyDown: ({ editor, event }) => {
        const shortcut = findShortcut(
          event,
          'editor',
          useSettingsStore.getState().shortcuts,
        );
        if (!shortcut || ACTIONS[shortcut.id](editor) === false) return;
        event.preventDefault();
        return true;
      },
    },
  }),
];
