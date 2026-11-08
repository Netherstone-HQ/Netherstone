import { Button } from "@/components/ui/button";
import links from "@/data/links.json";
import type { Ending } from "@/store/assistant";
import { cn } from "@/lib/utils";

import { endingText } from "./setup";

/** Where to read how to fix an ending, for the ones a link helps with. */
function helpFor(ending: Ending): string | null {
  return ending.kind === "error" && ending.error === "contextTooSmall"
    ? links.ollamaContextLength
    : null;
}

/** Errors that may pass if the answer goes on a moment later. */
const PASSING = new Set(["rateLimited", "busy", "unreachable", "timedOut"]);

/**
 * What an answer that didn't end well says under it, and for an error that
 * may pass, Try again to go on from where it stopped. Changes it proposed
 * before the error stay above it.
 */
export function EndingNote({
  ending,
  onOpenLink,
  onRetry,
  partly,
}: {
  ending: Ending;
  onOpenLink: (href: string) => void;
  /** Goes on with the answer; left out where it can't. */
  onRetry?: () => void;
  /** Whether the answer proposed changes before it stopped. */
  partly?: boolean;
}) {
  const help = helpFor(ending);
  const retry =
    onRetry && ending.kind === "error" && PASSING.has(ending.error)
      ? onRetry
      : null;
  return (
    <div className="flex flex-col items-start gap-1.5">
    <p
      role={ending.kind === "error" ? "alert" : undefined}
      className={cn(
        "text-ui-sm",
        ending.kind === "error" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {endingText(ending)}
      {help ? (
        <>
          {" "}
          <button
            type="button"
            onClick={() => onOpenLink(help)}
            className="underline underline-offset-2"
          >
            How to raise it
          </button>
        </>
      ) : null}
    </p>
    {partly && ending.kind === "error" ? (
      <p className="text-muted-foreground text-ui-sm">
        The changes above came before it stopped. The rest weren't proposed.
      </p>
    ) : null}
    {retry ? (
      <Button type="button" variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    ) : null}
    </div>
  );
}
