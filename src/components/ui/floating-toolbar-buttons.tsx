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

import { CommentToolbarButton } from './comment-toolbar-button';
import { LinkToolbarButton } from './link-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { SuggestionToolbarButton } from './suggestion-toolbar-button';
import { ToolbarGroup } from './toolbar';
import { TurnIntoToolbarButton } from './turn-into-toolbar-button';

export function FloatingToolbarButtons() {
  const readOnly = useEditorReadOnly();

  return (
    <>
      {!readOnly && (
        <ToolbarGroup>
          <TurnIntoToolbarButton />

          <MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold (Ctrl+B)">
            <BoldIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic (Ctrl+I)">
            <ItalicIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.underline} tooltip="Underline (Ctrl+U)">
            <UnderlineIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.strikethrough} tooltip="Strikethrough">
            <StrikethroughIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.code} tooltip="Code">
            <Code2Icon />
          </MarkToolbarButton>

          <LinkToolbarButton />
        </ToolbarGroup>
      )}

      <ToolbarGroup>
        <CommentToolbarButton />
        <SuggestionToolbarButton />
      </ToolbarGroup>
    </>
  );
}
