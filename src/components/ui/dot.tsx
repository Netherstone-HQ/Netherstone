import { cn } from "@/lib/utils";

/**
 * A separator drawn as a dot. It holds a real space, kept but not shown, so
 * copied text and screen readers read "3 files 1.2 MB", not "3 files1.2 MB".
 * Use it for every separator: never type a middle dot, never draw one by hand
 * (dot.test.tsx checks the source for both).
 *
 * The dot sits in a box one line tall, so it's centered on the line the same
 * way in running text and in a row of centered items, beside icons too.
 */
export function Dot({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "mx-1.5 inline-flex h-[1lh] shrink-0 items-center align-top",
        className,
      )}
    >
      <span className="inline-block size-[3px] overflow-hidden whitespace-pre rounded-full bg-muted-foreground text-[0px]">
        {" "}
      </span>
    </span>
  );
}
