'use client';

import data from '@emoji-mart/data';
import { EmojiInputPlugin, EmojiPlugin } from '@platejs/emoji/react';

import { EmojiInputElement } from '@/components/ui/emoji-node';

export const EmojiKit = [
  EmojiPlugin.configure({
    options: {
      data: data as any,
    },
  }),
  EmojiInputPlugin.withComponent(EmojiInputElement),
];
