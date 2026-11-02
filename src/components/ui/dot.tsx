import { cn } from "@/lib/utils";

/**
 * A separator drawn as a dot. It holds a real space, kept but not shown, so
 * copied text and screen readers read "3 files 1.2 MB", not "3 files1.2 MB".
 * Use it for every separator: never type a middle dot, never draw one by hand
 * (dot.test.tsx checks the source for both).
 */
export function Dot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "mx-1.5 inline-block size-[3px] shrink-0 translate-y-[-2px] overflow-hidden whitespace-pre rounded-full bg-muted-foreground/70 align-middle text-[0px]",
        className,
      )}
    >
      {" "}
    </span>
  );
}
