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

/** What an answer that didn't end well says under it. */
export function EndingNote({
  ending,
  onOpenLink,
}: {
  ending: Ending;
  onOpenLink: (href: string) => void;
}) {
  const help = helpFor(ending);
  return (
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
  );
}
