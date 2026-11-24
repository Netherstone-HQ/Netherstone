import * as React from "react";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePhoneNav } from "./nav";

/**
 * A full phone screen: room for the status bar on top and the system's
 * gesture or button bar below, with the screen's own parts between.
 */
export function PhoneFrame({
  className,
  children,
  bottomInset = true,
}: {
  className?: string;
  children: React.ReactNode;
  /** False when a bottom bar of the screen's own takes that room itself. */
  bottomInset?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-background pt-safe-top text-foreground",
        bottomInset && "pb-safe-bottom",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A 48 px round button holding one icon, named for screen readers. */
export const PhoneIconButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentProps<"button"> & { label: string }
>(function PhoneIconButton({ label, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center rounded-full text-foreground outline-none active:bg-accent focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-5",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/** The 64 px bar at the top of a screen. */
export function PhoneTopBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex h-16 shrink-0 items-center px-1", className)}>
      {children}
    </div>
  );
}

/** Back to the screen this one was opened from. */
export function PhoneBackButton() {
  const back = usePhoneNav((s) => s.back);
  return (
    <PhoneIconButton label="Back" onClick={back}>
      <ArrowLeftIcon />
    </PhoneIconButton>
  );
}

/** A screen's title in its top bar. */
export function PhoneTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="min-w-0 flex-1 truncate pl-1 text-xl leading-7 font-semibold">
      {children}
    </h1>
  );
}

/** The small grey heading over a group of rows. */
export function PhoneSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label}>
      <h2 className="px-4 pt-6 pb-2.5 text-sm leading-5 font-medium text-muted-foreground">
        {label}
      </h2>
      {children}
    </section>
  );
}
