"use client";

import {
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * Toasts drawn in the app's own colors. Sonner's built-in look is unlayered
 * CSS that outranks Tailwind's classes, so toasts are `unstyled` and take
 * their whole look from `classNames`. Sonner's `theme` only colors that
 * built-in look (and in dark, still the description), so it's left unset.
 */
function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      // Sonner sets its own font on the list; the toasts use the app's.
      style={{ fontFamily: "var(--font-sans)" }}
      icons={{
        success: <CircleCheckIcon className="size-4 text-brand" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        warning: (
          <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
        ),
        error: <CircleXIcon className="size-4 text-destructive" />,
        loading: (
          <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
        ),
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-(--width) items-start gap-3 rounded-lg border bg-popover px-4 py-3 text-popover-foreground text-ui shadow-lg",
          icon: "mt-0.5 flex size-4 shrink-0 items-center justify-center",
          content: "flex min-w-0 flex-1 flex-col gap-0.5",
          title: "font-medium",
          description: "text-muted-foreground text-ui-sm",
          actionButton:
            "h-7 shrink-0 self-center rounded-md border px-2.5 font-medium text-ui-sm transition-colors hover:bg-accent",
          cancelButton:
            "h-7 shrink-0 self-center rounded-md px-2.5 text-muted-foreground text-ui-sm transition-colors hover:bg-accent",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
