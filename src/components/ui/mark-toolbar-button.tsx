'use client';

import * as React from 'react';

import { useMarkToolbarButton, useMarkToolbarButtonState } from 'platejs/react';

import { useShortcutKeys } from '@/hooks/useShortcut';
import { withShortcut } from '@/lib/platform';
import type { ShortcutId } from '@/lib/shortcuts';

import { ToolbarButton } from './toolbar';

export function MarkToolbarButton({
  clear,
  nodeType,
  shortcut,
  tooltip,
  ...props
}: React.ComponentProps<typeof ToolbarButton> & {
  nodeType: string;
  clear?: string[] | string;
  /** Adds the mark's keys to a text tooltip: "Bold (Ctrl+B)". */
  shortcut?: ShortcutId;
}) {
  const state = useMarkToolbarButtonState({ clear, nodeType });
  const { props: buttonProps } = useMarkToolbarButton(state);
  const keys = useShortcutKeys(shortcut);

  return (
    <ToolbarButton
      {...props}
      {...buttonProps}
      tooltip={typeof tooltip === 'string' ? withShortcut(tooltip, keys) : tooltip}
    />
  );
}
