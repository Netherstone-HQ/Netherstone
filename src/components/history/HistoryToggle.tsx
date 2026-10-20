import { HistoryIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { type HistoryPlace, useHistoryStore } from "@/store/history";

/** Shows or hides the open file's history, in the top bar. */
export function HistoryToggle({ place }: { place: HistoryPlace }) {
  const isOpen = useHistoryStore((s) => s.openIn === place);
  const openHistory = useHistoryStore((s) => s.openHistory);
  const closeHistory = useHistoryStore((s) => s.closeHistory);
  const label = isOpen ? "Hide history" : "Show history";

  return (
    <Hint label={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => (isOpen ? closeHistory() : openHistory(place))}
        aria-label={label}
        aria-pressed={isOpen}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          isOpen && "bg-accent text-foreground",
        )}
      >
        <HistoryIcon />
      </Button>
    </Hint>
  );
}
