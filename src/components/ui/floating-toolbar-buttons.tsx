'use client';

import {
  BoldIcon,
  Code2Icon,
  ItalicIcon,
  MessageSquareIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from 'lucide-react';
import { KEYS } from 'platejs';
import { useEditorReadOnly, useEditorRef } from 'platejs/react';

import { hasInlineAsk, openInlineAsk } from '@/lib/inline-ask';
import { useAssistantStore } from '@/store/assistant';

import { LinkToolbarButton } from './link-toolbar-button';
import { MarkToolbarButton } from './mark-toolbar-button';
import { ToolbarButton, ToolbarGroup } from './toolbar';
import { TurnIntoToolbarButton } from './turn-into-toolbar-button';

export function FloatingToolbarButtons() {
  const readOnly = useEditorReadOnly();
  const editor = useEditorRef();
  const assistant =
    useAssistantStore((s) => s.enabled === true) && hasInlineAsk(editor);

  return (
    <>
      {!readOnly && assistant && (
        <div className="relative flex">
          <div className="flex items-center">
            <ToolbarButton
              className="gap-1.5 px-2"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => openInlineAsk(editor)}
            >
              <MessageSquareIcon />
              Ask
            </ToolbarButton>
          </div>
          <div
            role="separator"
            aria-orientation="vertical"
            className="mx-1.5 my-1 w-px shrink-0 self-stretch bg-border"
          />
        </div>
      )}
      {!readOnly && (
        <ToolbarGroup>
          <TurnIntoToolbarButton />

          <MarkToolbarButton nodeType={KEYS.bold} tooltip="Bold" shortcut="bold">
            <BoldIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.italic} tooltip="Italic" shortcut="italic">
            <ItalicIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.underline} tooltip="Underline" shortcut="underline">
            <UnderlineIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.strikethrough} tooltip="Strikethrough" shortcut="strikethrough">
            <StrikethroughIcon />
          </MarkToolbarButton>

          <MarkToolbarButton nodeType={KEYS.code} tooltip="Code" shortcut="code">
            <Code2Icon />
          </MarkToolbarButton>

          <LinkToolbarButton />
        </ToolbarGroup>
      )}
    </>
  );
}
