'use client';

import {
  BlockquoteRules,
  HeadingRules,
  HorizontalRuleRules,
} from '@platejs/basic-nodes';
import {
  BlockquotePlugin,
  H1Plugin,
  H2Plugin,
  H3Plugin,
  H4Plugin,
  H5Plugin,
  H6Plugin,
  HorizontalRulePlugin,
} from '@platejs/basic-nodes/react';
import { ElementApi, KEYS, type Descendant, type Path } from 'platejs';
import { ParagraphPlugin } from 'platejs/react';

import { BlockquoteElement } from '@/components/ui/blockquote-node';
import {
  H1Element,
  H2Element,
  H3Element,
  H4Element,
  H5Element,
  H6Element,
} from '@/components/ui/heading-node';
import { HrElement } from '@/components/ui/hr-node';
import { ParagraphElement } from '@/components/ui/paragraph-node';

export const BasicBlocksKit = [
  ParagraphPlugin.withComponent(ParagraphElement),
  H1Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: {
      component: H1Element,
    },
    rules: {
      break: { empty: 'reset' },
    },
    shortcuts: { toggle: { keys: 'mod+alt+1' } },
  }),
  H2Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: {
      component: H2Element,
    },
    rules: {
      break: { empty: 'reset' },
    },
    shortcuts: { toggle: { keys: 'mod+alt+2' } },
  }),
  H3Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: {
      component: H3Element,
    },
    rules: {
      break: { empty: 'reset' },
    },
    shortcuts: { toggle: { keys: 'mod+alt+3' } },
  }),
  H4Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: {
      component: H4Element,
    },
    rules: {
      break: { empty: 'reset' },
    },
    shortcuts: { toggle: { keys: 'mod+alt+4' } },
  }),
  H5Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: {
      component: H5Element,
    },
    rules: {
      break: { empty: 'reset' },
    },
    shortcuts: { toggle: { keys: 'mod+alt+5' } },
  }),
  H6Plugin.configure({
    inputRules: [HeadingRules.markdown()],
    node: {
      component: H6Element,
    },
    rules: {
      break: { empty: 'reset' },
    },
    shortcuts: { toggle: { keys: 'mod+alt+6' } },
  }),
  BlockquotePlugin.configure({
    inputRules: [BlockquoteRules.markdown()],
    node: { component: BlockquoteElement },
    shortcuts: { toggle: { keys: 'mod+shift+period' } },
  }).overrideEditor(({ editor, tf: { normalizeNode }, type }) => ({
    transforms: {
      /**
       * A quote holds paragraphs. A new or turned-into quote starts with bare
       * text, and Plate's own fix replaces all of the quote's children, which
       * drops the caret to the end of the block before it. Moving the text
       * into a paragraph instead keeps the caret where it was.
       */
      normalizeNode([node, path]) {
        if (ElementApi.isElement(node) && node.type === type) {
          const runs = inlineRuns(node.children, (child) =>
            ElementApi.isElement(child) && editor.api.isBlock(child),
          );
          if (runs.length > 0) {
            editor.tf.withoutNormalizing(() => {
              // Last run first, so the earlier runs keep their indexes.
              for (const [start, end] of runs.reverse()) {
                const at: Path = [...path, start];
                editor.tf.insertNodes(
                  { type: editor.getType(KEYS.p), children: [] },
                  { at },
                );
                for (let index = 0; index < end - start; index++) {
                  editor.tf.moveNodes({
                    at: [...path, start + 1],
                    to: [...at, index],
                  });
                }
              }
            });
            return;
          }
        }
        normalizeNode([node, path]);
      },
    },
  })),
  HorizontalRulePlugin.configure({
    inputRules: [
      HorizontalRuleRules.markdown({ variant: '-' }),
      HorizontalRuleRules.markdown({ variant: '_' }),
    ],
    node: {
      component: HrElement,
    },
  }),
];

/** The [start, end) index ranges of the children that are not blocks. */
function inlineRuns(
  children: Descendant[],
  isBlock: (child: Descendant) => boolean,
): [number, number][] {
  const runs: [number, number][] = [];
  let start = -1;
  children.forEach((child, index) => {
    if (isBlock(child)) {
      if (start !== -1) runs.push([start, index]);
      start = -1;
    } else if (start === -1) {
      start = index;
    }
  });
  if (start !== -1) runs.push([start, children.length]);
  return runs;
}
