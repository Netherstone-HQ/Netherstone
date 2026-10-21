"use client";

import * as React from "react";

import { useCalloutEmojiPicker } from "@platejs/callout/react";
import { useEmojiDropdownMenuState } from "@platejs/emoji/react";
import { PlateElement } from "platejs/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { EmojiPicker, EmojiPopover } from "./emoji-toolbar-button";

export function CalloutElement({
  attributes,
  children,
  className,
  ...props
}: React.ComponentProps<typeof PlateElement>) {
  const { emojiPickerState, isOpen, setIsOpen } = useEmojiDropdownMenuState({
    closeOnSelect: true,
  });

  const { emojiToolbarDropdownProps, props: calloutProps } =
    useCalloutEmojiPicker({
      isOpen,
      setIsOpen,
    });

  return (
    <PlateElement
      className={cn("my-1 rounded-sm bg-muted px-3 py-3", className)}
      style={{
        backgroundColor: props.element.backgroundColor as any,
      }}
      attributes={{
        ...attributes,
        "data-plate-open-context-menu": true,
      }}
      {...props}
    >
      <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 rounded-md">
        {/* One text line tall (plus the paragraph's padding), so the emoji
            sits on the first line at every text size. */}
        <div
          contentEditable={false}
          className="box-content flex h-[1lh] shrink-0 items-center py-1"
        >
          <EmojiPopover
            {...emojiToolbarDropdownProps}
            control={
              <Button
                type="button"
                variant="ghost"
                className="flex size-7 select-none items-center justify-center rounded-md p-0 font-emoji text-[18px] leading-none hover:bg-muted-foreground/15"
                contentEditable={false}
              >
                {(props.element.icon as any) || "💡"}
              </Button>
            }
          >
            <EmojiPicker {...emojiPickerState} {...calloutProps} />
          </EmojiPopover>
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </PlateElement>
  );
}
