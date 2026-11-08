import { BrainIcon, CheckIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { applyMemory, discardMemory, undoMemory } from "@/lib/assistant-memory";
import type { ChatMemory } from "@/lib/commands/assistant";
import { useAssistantStore } from "@/store/assistant";

/** An item an answer offered to remember: to add to memory or not. */
export function MemoryCard({ memory }: { memory: ChatMemory }) {
  const busy = useAssistantStore((s) => s.busyChanges.includes(memory.id));
  if (memory.state === "applied") {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border bg-card py-2.5 pr-2 pl-3">
        <CheckIcon className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 truncate">Added to memory</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void undoMemory(memory)}
        >
          Undo
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border bg-card p-3">
      <div className="flex items-center gap-2">
        <BrainIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="font-medium">Add to memory</span>
      </div>
      <p className="break-words">{memory.text}</p>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void discardMemory(memory)}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void applyMemory(memory)}
        >
          Apply
        </Button>
      </div>
    </div>
  );
}
