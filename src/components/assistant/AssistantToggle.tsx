import { useEffect } from "react";
import { MessageSquareIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import {
  closeAssistant,
  loadAssistantEnabled,
  openAssistant,
} from "@/lib/assistant";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/store/assistant";

/** Shows or hides the assistant, in the top bar. Gone while it's off. */
export function AssistantToggle() {
  const enabled = useAssistantStore((s) => s.enabled);
  const isOpen = useAssistantStore((s) => s.isOpen);

  useEffect(() => {
    if (useAssistantStore.getState().enabled === null) {
      void loadAssistantEnabled();
    }
  }, []);

  if (!enabled) return null;
  const label = isOpen ? "Hide assistant" : "Show assistant";

  return (
    <Hint label={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => (isOpen ? closeAssistant() : openAssistant())}
        aria-label={label}
        aria-pressed={isOpen}
        className={cn(
          "text-muted-foreground hover:text-foreground",
          isOpen && "bg-accent text-foreground",
        )}
      >
        <MessageSquareIcon />
      </Button>
    </Hint>
  );
}
