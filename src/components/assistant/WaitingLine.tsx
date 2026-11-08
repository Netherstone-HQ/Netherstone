import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { waitingText } from "./setup";

type Answering = Parameters<typeof waitingText>[0];

/**
 * What an answer coming in waits on. Its line stays while the answer
 * streams, empty when there's nothing to say, so the text above doesn't
 * move when a tool starts or ends.
 */
export function WaitingLine({
  answering,
  local,
  className,
}: {
  answering: Answering;
  local?: boolean;
  className?: string;
}) {
  const shown = answering.tool !== null || !answering.text;
  return (
    <p
      aria-hidden={!shown}
      className={cn(
        "flex items-center gap-2 text-muted-foreground text-ui-sm",
        !shown && "invisible",
        className,
      )}
    >
      <LoaderCircleIcon className="size-3.5 animate-spin" />
      {waitingText(answering, local)}
    </p>
  );
}
