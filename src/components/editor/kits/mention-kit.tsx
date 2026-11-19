import { MentionInputPlugin, MentionPlugin } from '@platejs/mention/react';

import { stepOver } from '@/components/editor/step-over';
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
    .overrideEditor(stepOver)
    .withComponent(MentionElement),
  MentionInputPlugin.withComponent(MentionInputElement),
];
