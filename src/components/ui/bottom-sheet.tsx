import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/** How tall the sheet is: as tall as its content, half the screen, or all of it. */
export type BottomSheetHeight = "auto" | "half" | "full";

const HEIGHTS: Record<BottomSheetHeight, string> = {
  auto: "max-h-[calc(100dvh-3rem)]",
  half: "h-[50dvh]",
  full: "h-[calc(100dvh-3rem)]",
};

/**
 * A panel that slides up from the bottom of a phone screen over a dimmed
 * backdrop. A tap on the backdrop, Back or Esc closes it.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  actions,
  height = "auto",
  className,
  children,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Shown at the top, and the sheet's name for screen readers. */
  title: React.ReactNode;
  /** Buttons at the end of the title row. */
  actions?: React.ReactNode;
  height?: BottomSheetHeight;
  className?: string;
  children: React.ReactNode;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-slot="bottom-sheet-overlay"
          className="fixed inset-0 z-50 bg-black/55 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Content
          data-slot="bottom-sheet"
          aria-describedby={undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-[20px] border-t border-border bg-popover text-popover-foreground outline-none",
            "pb-[var(--safe-area-bottom,env(safe-area-inset-bottom))]",
            "duration-200 data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom",
            HEIGHTS[height],
            className,
          )}
        >
          <div
            aria-hidden="true"
            className="mx-auto mt-3 mb-2 h-1 w-8 shrink-0 rounded-full bg-input"
          />
          <div className="flex min-h-11 shrink-0 items-center gap-2 pr-1 pl-4">
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
              {title}
            </DialogPrimitive.Title>
            {actions}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** A row in a sheet's menu: icon, label, and an optional chevron or value at the end. */
export function BottomSheetItem({
  icon,
  children,
  end,
  danger,
  className,
  ...props
}: React.ComponentProps<"button"> & {
  icon?: React.ReactNode;
  end?: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-13 w-full items-center gap-4 px-4 text-left text-base outline-none active:bg-accent disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0",
        danger
          ? "text-destructive"
          : "text-foreground [&>span:first-child_svg]:text-muted-foreground",
        className,
      )}
      {...props}
    >
      {icon && <span className="flex">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {end && <span className="flex text-muted-foreground">{end}</span>}
    </button>
  );
}

/** A line between groups of sheet rows. */
export function BottomSheetSeparator() {
  return <div role="separator" className="my-2 h-px bg-border" />;
}
