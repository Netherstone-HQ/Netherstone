import data, { type EmojiMartData } from '@emoji-mart/data';
import { EmojiInputPlugin, EmojiPlugin } from '@platejs/emoji/react';

import { EmojiInputElement } from '@/components/ui/emoji-node';

export const EmojiKit = [
  EmojiPlugin.configure({
    options: {
      // The package's JSON has no type of its own; this is its shape.
      data: data as EmojiMartData,
    },
  }),
  EmojiInputPlugin.withComponent(EmojiInputElement),
];
