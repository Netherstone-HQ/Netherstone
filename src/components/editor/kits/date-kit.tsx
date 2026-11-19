import { DatePlugin } from '@platejs/date/react';

import { stepOver } from '@/components/editor/step-over';
import { DateElement } from '@/components/ui/date-node';

export const DateKit = [
  DatePlugin.overrideEditor(stepOver).withComponent(DateElement),
];
