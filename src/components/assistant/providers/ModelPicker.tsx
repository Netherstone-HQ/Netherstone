import { useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import {
  type Models,
  ModelList,
  modelGroups,
  modelName,
} from "@/components/assistant/models";
import { Dot } from "@/components/ui/dot";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { AssistantProvider, ModelChoice } from "@/lib/commands/assistant";

export function ModelPicker({
  providers,
  models,
  value,
  onPick,
}: {
  providers: AssistantProvider[];
  models: Record<string, Models>;
  value: ModelChoice | null;
  onPick: (choice: ModelChoice) => void;
}) {
  const [open, setOpen] = useState(false);
  const groups = modelGroups(providers, models);

  const picked = value
    ? groups
        .find((group) => group.provider.id === value.provider)
        ?.items.find(
          (item) =>
            item.model.id === value.model && item.server === value.server,
        )
    : undefined;
  const pickedProvider = providers.find((p) => p.id === value?.provider);
  const empty = groups.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Model"
          disabled={empty && !value}
          className="flex h-8 w-75 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-ui shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className="flex min-w-0 items-center">
            {value ? (
              <>
                <span className="truncate">
                  {picked ? modelName(picked.model) : value.model}
                </span>
                <Dot />
                <span className="shrink-0 text-muted-foreground text-ui-sm">
                  {pickedProvider?.setup === "local"
                    ? "Local"
                    : pickedProvider?.name}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {empty ? "No models yet" : "Pick a model"}
              </span>
            )}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-75 p-0">
        <ModelList
          providers={providers}
          models={models}
          value={value}
          onPick={(choice) => {
            onPick(choice);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
