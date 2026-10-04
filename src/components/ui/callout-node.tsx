"use client";

import * as React from "react";

import { useCalloutEmojiPicker } from "@platejs/callout/react";
import { useEmojiDropdownMenuState } from "@platejs/emoji/react";
import { PlateElement } from "platejs/react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { EmojiPicker, EmojiPopover } from "./emoji-toolbar-button";

const EMOJI_FONT_FAMILY =
  '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols, sans-serif';

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
        <div contentEditable={false} className="shrink-0 pt-0.5">
          <EmojiPopover
            {...emojiToolbarDropdownProps}
            control={
              <Button
                type="button"
                variant="ghost"
                className="flex size-7 select-none items-center justify-center rounded-md p-0 text-[18px] leading-none hover:bg-muted-foreground/15"
                style={{
                  fontFamily: EMOJI_FONT_FAMILY,
                }}
                contentEditable={false}
              >
                {(props.element.icon as any) || "💡"}
              </Button>
            }
          >
            <EmojiPicker {...emojiPickerState} {...calloutProps} />
          </EmojiPopover>
        </div>
        <div className="min-w-0 pt-px leading-6">{children}</div>
      </div>
    </PlateElement>
  );
}
