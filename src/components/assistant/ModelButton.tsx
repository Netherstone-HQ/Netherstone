import { useEffect } from "react";
import { ChevronDownIcon } from "lucide-react";
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

const NO_IMAGES = "This model can't see images, so they're left out";

function MaybeHint({
  label,
  children,
}: {
  label: string | null;
  children: React.ReactElement;
}) {
  return label ? (
    <Hint label={label} side="top">
      {children}
    </Hint>
  ) : (
    children
  );
}

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

  // Shown each time it opens, from the button or the panel's Pick a model.
  useEffect(() => {
    if (open) loadAll(status.providers);
  }, [open, loadAll, status.providers]);

  // Said on the button, so the shard's pictures being left out is no surprise.
  const noImages = !!picked && !picked.images && sendFiles && !disabled;

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
        <MaybeHint label={noImages ? NO_IMAGES : null}>
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
        </MaybeHint>
        <PopoverContent align="start" side="top" className="w-75 p-0">
          <ModelList
            providers={status.providers}
            models={models}
            value={status.model}
            onPick={(choice) => void pick(choice)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
