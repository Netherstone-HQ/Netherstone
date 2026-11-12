'use client';

import * as React from 'react';

import type { VariantProps } from 'class-variance-authority';

import {
  Caption as CaptionPrimitive,
  CaptionPlugin,
  CaptionTextarea as CaptionTextareaPrimitive,
  useCaptionButton,
  useCaptionButtonState,
  useCaptionString,
} from '@platejs/caption/react';
import { createPrimitiveComponent } from '@udecode/cn';
import { cva } from 'class-variance-authority';
import { isHotkey, PathApi } from 'platejs';
import {
  useEditorRef,
  useElement,
  usePluginOption,
  useReadOnly,
} from 'platejs/react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const captionVariants = cva('max-w-full', {
  defaultVariants: {
    align: 'center',
  },
  variants: {
    align: {
      center: 'mx-auto',
      left: 'mr-auto',
      right: 'ml-auto',
    },
  },
});

export function Caption({
  align,
  className,
  ...props
}: React.ComponentProps<typeof CaptionPrimitive> &
  VariantProps<typeof captionVariants>) {
  return (
    <CaptionPrimitive
      {...props}
      className={cn(captionVariants({ align }), className)}
    />
  );
}

const captionTextClassName = cn(
  'mt-2 w-full border-none bg-inherit p-0 font-[inherit] text-inherit',
  'text-center'
);

/** Where in its text a click at (`x`, `y`) on `element` landed, if it did. */
function textOffsetAt(element: HTMLElement, x: number, y: number) {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) {
    return position.offsetNode.parentNode === element ? position.offset : undefined;
  }
  const range = document.caretRangeFromPoint?.(x, y);
  return range?.startContainer.parentNode === element ? range.startOffset : undefined;
}

/**
 * A caption with text shows as plain text until it's clicked or focused:
 * every auto-sizing textarea reads its computed style when it mounts, which
 * made opening a shard with many pictures slow.
 */
export function CaptionTextarea(
  props: React.ComponentProps<typeof CaptionTextareaPrimitive>
) {
  const editor = useEditorRef();
  const element = useElement();
  const editorReadOnly = useReadOnly();
  const readOnly = props.readOnly || editorReadOnly;
  const captionString = useCaptionString();
  const focusEndPath = usePluginOption(CaptionPlugin, 'focusEndPath');
  const [editing, setEditing] = React.useState(false);
  const caretRef = React.useRef<number | null>(null);

  // The keyboard and the Caption button move into a caption by asking its
  // textarea to take focus.
  const focusAsked =
    !!focusEndPath &&
    PathApi.equals(editor.api.findPath(element) ?? [], focusEndPath);

  // Plate's textarea is there only from its second render, after Plate's
  // own focus effect has run, so the focus is given here once it's there.
  const [textarea, setTextarea] = React.useState<HTMLTextAreaElement | null>(
    null
  );
  React.useEffect(() => {
    if (!textarea) return;
    const caret =
      caretRef.current ?? (focusAsked ? textarea.value.length : null);
    if (caret === null) return;

    caretRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    if (focusAsked) editor.setOption(CaptionPlugin, 'focusEndPath', null);
  }, [editor, focusAsked, textarea]);

  if (captionString && !editing && !focusAsked) {
    const startEditing = (caret: number) => {
      caretRef.current = caret;
      setEditing(true);
    };

    return (
      <div
        className={cn(
          captionTextClassName,
          'cursor-text break-words whitespace-pre-wrap',
          props.className
        )}
        tabIndex={readOnly ? undefined : 0}
        onFocus={
          readOnly ? undefined : () => startEditing(captionString.length)
        }
        onMouseDown={
          readOnly
            ? undefined
            : (event) => {
                event.preventDefault();
                startEditing(
                  textOffsetAt(event.currentTarget, event.clientX, event.clientY) ??
                    captionString.length
                );
              }
        }
      >
        {captionString}
      </div>
    );
  }

  return (
    <CaptionTextareaPrimitive
      {...props}
      ref={setTextarea}
      className={cn(
        captionTextClassName,
        'resize-none focus:outline-none focus:[&::placeholder]:opacity-0',
        'print:placeholder:text-transparent',
        props.className
      )}
      // Up selects the picture and Down goes to the start of the next block.
      // Plate's own keys select while the editor has no selection, and the
      // editor's focus then puts the caret at the top of the shard instead.
      onKeyDownCapture={(event) => {
        const down = isHotkey('down', event);
        if (!down && !isHotkey('up', event)) return;

        const path = editor.api.findPath(element);
        const target = path && (down ? PathApi.next(path) : path);
        if (!target || !editor.api.node(target)) return;

        event.preventDefault();
        event.stopPropagation();
        editor.tf.focus();
        editor.tf.select(down ? editor.api.start(target) : target);
      }}
      onFocusCapture={() => setEditing(true)}
      // Leaving the window keeps it, so focus comes back to it.
      onBlurCapture={() => {
        if (document.hasFocus()) setEditing(false);
      }}
    />
  );
}

export const CaptionButton = createPrimitiveComponent(Button)({
  propsHook: useCaptionButton,
  stateHook: useCaptionButtonState,
});
