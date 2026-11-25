import * as React from "react";
import { ArrowLeftIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePhoneNav } from "./nav";

/** A full phone screen, clear of the status bar and the system's bottom bar. */
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

/** A word button in a top bar, such as Select. */
export function PhoneTextButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "h-12 shrink-0 rounded-full px-3 font-medium outline-none active:bg-accent",
        className,
      )}
      {...props}
    />
  );
}

/** The bar at the bottom of a screen, above the system's own bar. */
export function PhoneBottomBar({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="shrink-0 border-t bg-sidebar pb-safe-bottom">
      <div className={cn("flex", className)}>{children}</div>
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
