'use client';

import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorReadOnly } from 'platejs/react';

import { withShortcut } from '@/lib/platform';

import { LinkToolbarButton } from './link-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { ToolbarGroup } from './toolbar';
import { TurnIntoToolbarButton } from './turn-into-toolbar-button';

export function FloatingToolbarButtons() {
  const readOnly = useEditorReadOnly();

  return (
    <>
      {!readOnly && (
        <ToolbarGroup>
          <TurnIntoToolbarButton />

          <MarkToolbarButton nodeType={KEYS.bold} tooltip={withShortcut("Bold", "mod+b")}>
            <BoldIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.italic} tooltip={withShortcut("Italic", "mod+i")}>
            <ItalicIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.underline} tooltip={withShortcut("Underline", "mod+u")}>
            <UnderlineIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.strikethrough} tooltip={withShortcut("Strikethrough", "mod+shift+x")}>
            <StrikethroughIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.code} tooltip={withShortcut("Code", "mod+e")}>
            <Code2Icon />
          </MarkToolbarButton>

          <LinkToolbarButton />
        </ToolbarGroup>
      )}
    </>
  );
}
