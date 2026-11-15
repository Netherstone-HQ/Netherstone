import { MentionInputPlugin, MentionPlugin } from '@platejs/mention/react';
import { PointApi, type Point, type TRange } from 'platejs';

import {
  MentionElement,
  MentionInputElement,
} from '@/components/ui/mention-node';

export const MentionKit = [
  MentionPlugin.configure({
    options: {
      triggerPreviousCharPattern: /^$|^[\s"']$/,
    },
  })
    .overrideEditor(({ editor, tf: { move }, type }) => {
      const inMention = (point: Point) =>
        !!editor.api.above({ at: point, match: { type } });
      // Whether a point the move changed ended up inside an @ link.
      const movedIn = (before: TRange, after: TRange) =>
        (!PointApi.equals(before.anchor, after.anchor) &&
          inMention(after.anchor)) ||
        (!PointApi.equals(before.focus, after.focus) &&
          inMention(after.focus));

      return {
        transforms: {
          /**
           * The arrow keys step over an @ link in one press. The browser can't
           * show a caret inside one: it moves it to the top of the shard, and
           * the next key lands there.
           */
          move(options) {
            let before = editor.selection;
            move(options);
            while (
              before &&
              editor.selection &&
              movedIn(before, editor.selection)
            ) {
              before = editor.selection;
              move(options);
            }
          },
        },
      };
    })
    .withComponent(MentionElement),
  MentionInputPlugin.withComponent(MentionInputElement),
];
