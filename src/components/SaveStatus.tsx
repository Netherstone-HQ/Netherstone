import { CircleCheckIcon, LoaderCircleIcon } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SaveState = "saved" | "saving" | "unsaved" | "failed";

/**
 * The open file's save state, for the top bar: a check while it's saved,
 * with words only while saving or when changes haven't reached the disk.
 */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 px-1 text-ui-sm text-muted-foreground">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  if (state === "unsaved" || state === "failed") {
    return (
      <span className="flex items-center gap-1.5 px-1 text-ui-sm text-muted-foreground">
        <span
          className={cn(
            "size-1.5 rounded-full",
            state === "failed" ? "bg-destructive" : "bg-amber-500",
          )}
        />
        {state === "failed" ? "Couldn't save" : "Unsaved changes"}
      </span>
    );
  }

  return (
    <Hint label="Saved" side="bottom">
      <span
        role="img"
        aria-label="Saved"
        tabIndex={0}
        className="flex size-control items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CircleCheckIcon className="size-icon" />
      </span>
    </Hint>
  );
}
