import { useEffect } from "react";
import { ChevronDownIcon, ImageOffIcon } from "lucide-react";
import { toast } from "sonner";

import { Dot } from "@/components/ui/dot";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import { type ModelChoice, setAssistantModel } from "@/lib/commands";

import { ModelList, isSetUp, useModelLists } from "./models";
import type { Setup } from "./setup";

/** The model the chat uses, and the list to pick another. */
export function ModelButton({
  setup,
  sendFiles,
  disabled,
  open,
  onOpenChange,
  onPicked,
}: {
  setup: Setup;
  sendFiles: boolean;
  /** Shown but not usable, while the panel asks for something first. */
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPicked: () => void;
}) {
  const { models, loadAll } = useModelLists();
  const { picked, status } = setup;
  const hasProvider = status.providers.some(isSetUp);

  // Listed each time it opens, from the button or the panel's Pick a model.
  useEffect(() => {
    if (open) loadAll(status.providers);
  }, [open, loadAll, status.providers]);

  const pick = async (choice: ModelChoice) => {
    onOpenChange(false);
    try {
      await setAssistantModel(choice);
      onPicked();
    } catch {
      toast.error("Couldn't pick that model");
    }
  };

  return (
    <div className="flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Model"
            disabled={!hasProvider || disabled}
            className="flex h-7 min-w-0 items-center gap-1 rounded-md pr-1.5 pl-2 text-muted-foreground text-ui-sm hover:bg-accent hover:text-foreground disabled:pointer-events-none"
          >
            {picked ? (
              <>
                <span className="truncate">{picked.name ?? picked.id}</span>
                <Dot className="mx-1" />
                <span className="shrink-0">
                  {picked.local ? "Local" : picked.provider}
                </span>
              </>
            ) : (
              <span>{hasProvider ? "Pick a model" : "No model"}</span>
            )}
            {hasProvider && !disabled ? (
              <ChevronDownIcon className="size-3.5 shrink-0" />
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-75 p-0">
          <ModelList
            providers={status.providers}
            models={models}
            value={status.model}
            onPick={(choice) => void pick(choice)}
          />
        </PopoverContent>
      </Popover>
      {picked && !picked.images && sendFiles && !disabled ? (
        <Hint label="This model can't see images" side="top">
          <span
            aria-label="This model can't see images"
            className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground"
          >
            <ImageOffIcon className="size-3.5" />
          </span>
        </Hint>
      ) : null}
    </div>
  );
}
