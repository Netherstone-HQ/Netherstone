'use client';

import * as React from 'react';

import type { TInlineSuggestionData, TLinkElement } from 'platejs';
import type { PlateElementProps } from 'platejs/react';

import { getLinkAttributes } from '@platejs/link';
import { SuggestionPlugin } from '@platejs/suggestion/react';
import { PlateElement } from 'platejs/react';

import { cn } from '@/lib/utils';

/** A path with no scheme and no host, like `./other.md` or `notes/a.md`. */
function isRelativePath(url: string) {
  if (!url || url.startsWith('/') || url.startsWith('#')) return false;

  try {
    new URL(url);
    return false;
  } catch {
    return true;
  }
}

export function LinkElement(props: PlateElementProps<TLinkElement>) {
  const suggestionData = props.editor
    .getApi(SuggestionPlugin)
    .suggestion.suggestionData(props.element) as
    | TInlineSuggestionData
    | undefined;

  const linkAttributes = getLinkAttributes(props.editor, props.element);

  // Plate only keeps hrefs that parse as absolute URLs, which drops links to
  // other notes. Without an href, Editor.tsx can't open them on click. A
  // relative path has no scheme, so it can't be a javascript: URL.
  if (!linkAttributes.href && isRelativePath(props.element.url)) {
    linkAttributes.href = props.element.url;
  }

  return (
    <PlateElement
      {...props}
      as="a"
      className={cn(
        'font-medium text-primary underline decoration-primary underline-offset-4',
        suggestionData?.type === 'remove' && 'bg-red-100 text-red-700',
        suggestionData?.type === 'insert' && 'bg-emerald-100 text-emerald-700'
      )}
      attributes={{
        ...props.attributes,
        ...linkAttributes,
        onClick: (e) => {
          // Let Editor.tsx onClickCapture handle internal routing
        },
        onMouseOver: (e) => {
          e.stopPropagation();
        },
      }}
    >
      {props.children}
    </PlateElement>
  );
}
