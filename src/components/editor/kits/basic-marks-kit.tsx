'use client';

import {
  BoldRules,
  CodeRules,
  HighlightRules,
  ItalicRules,
  MarkComboRules,
  StrikethroughRules,
  SubscriptRules,
  SuperscriptRules,
  UnderlineRules,
} from '@platejs/basic-nodes';
import {
  BoldPlugin,
  CodePlugin,
  HighlightPlugin,
  ItalicPlugin,
  KbdPlugin,
  StrikethroughPlugin,
  SubscriptPlugin,
  SuperscriptPlugin,
  UnderlinePlugin,
} from '@platejs/basic-nodes/react';

import { CodeLeaf } from '@/components/ui/code-node';
import { HighlightLeaf } from '@/components/ui/highlight-node';
import { KbdLeaf } from '@/components/ui/kbd-node';

// Shortcuts come from the shortcut list (`src/lib/shortcuts.ts`, run by the
// shortcuts kit), so Plate's own keys are off.
export const BasicMarksKit = [
  BoldPlugin.configure({
    shortcuts: { toggle: null },
    inputRules: [
      BoldRules.markdown({ variant: '*' }),
      MarkComboRules.markdown({ variant: 'boldItalic' }),
      MarkComboRules.markdown({ variant: 'boldUnderline' }),
      MarkComboRules.markdown({ variant: 'boldItalicUnderline' }),
      MarkComboRules.markdown({ variant: 'italicUnderline' }),
    ],
  }),
  ItalicPlugin.configure({
    shortcuts: { toggle: null },
    inputRules: [
      ItalicRules.markdown({ variant: '*' }),
      ItalicRules.markdown({ variant: '_' }),
    ],
  }),
  UnderlinePlugin.configure({
    shortcuts: { toggle: null },
    inputRules: [UnderlineRules.markdown()],
  }),
  CodePlugin.configure({
    inputRules: [CodeRules.markdown()],
    node: { component: CodeLeaf },
  }),
  StrikethroughPlugin.configure({
    inputRules: [StrikethroughRules.markdown()],
  }),
  SubscriptPlugin.configure({
    inputRules: [SubscriptRules.markdown()],
  }),
  SuperscriptPlugin.configure({
    inputRules: [SuperscriptRules.markdown()],
  }),
  HighlightPlugin.configure({
    inputRules: [
      HighlightRules.markdown({ variant: '==' }),
      HighlightRules.markdown({ variant: '≡' }),
    ],
    node: { component: HighlightLeaf },
  }),
  KbdPlugin.withComponent(KbdLeaf),
];
