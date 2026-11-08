import { useEffect, useRef } from "react";
import { BrainIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { toast } from "sonner";

import { Dot } from "@/components/ui/dot";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Hint } from "@/components/ui/tooltip";
import {
  type ModelChoice,
  type Thinking,
  setAssistantModel,
  setAssistantThinking,
} from "@/lib/commands/assistant";

import { ModelList, isSetUp, useModelLists } from "./models";
import type { Setup } from "./setup";

const NO_IMAGES = "This model can't see images, so they're left out";

const LEVELS: { level: Thinking; name: string; detail: string }[] = [
  { level: "low", name: "Low", detail: "Quickest answers" },
  { level: "medium", name: "Medium", detail: "More thought, slower" },
  { level: "high", name: "High", detail: "For hard questions, slowest" },
];

/** How much the picked model thinks, for a model that can. */
function ThinkingButton({
  level,
  disabled,
  onPicked,
  onDone,
}: {
  level: Thinking;
  disabled: boolean;
  onPicked: () => void;
  onDone: () => void;
}) {
  const current = LEVELS.find((each) => each.level === level) ?? LEVELS[0];
  const picked = useRef(false);

  const pick = async (next: Thinking) => {
    picked.current = true;
    try {
      await setAssistantThinking(next);
      onPicked();
    } catch {
      toast.error("Couldn't change thinking");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Thinking: ${current.name}`}
          disabled={disabled}
          className="flex h-7 shrink-0 items-center gap-1 rounded-md pr-1.5 pl-2 text-muted-foreground text-ui-sm hover:bg-accent hover:text-foreground disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-foreground"
        >
          <BrainIcon className="size-3.5" />
          {current.name}
          {disabled ? null : <ChevronDownIcon className="size-3.5" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-60"
        onCloseAutoFocus={(event) => backToInput(event, picked, onDone)}
      >
        <DropdownMenuLabel className="pt-1.5 pb-1 font-normal text-muted-foreground text-ui-sm">
          Thinking
        </DropdownMenuLabel>
        {LEVELS.map((each) => (
          <DropdownMenuItem
            key={each.level}
            role="menuitemradio"
            aria-checked={each.level === level}
            onSelect={() => void pick(each.level)}
            className="justify-between"
          >
            <span className="flex flex-col">
              {each.name}
              <span className="text-muted-foreground text-ui-sm">{each.detail}</span>
            </span>
            {each.level === level ? <CheckIcon className="size-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * After a pick, the cursor goes back to where the message is typed, not to
 * the menu's button. Other closes keep the menu's own focus handling.
 */
function backToInput(
  event: Event,
  picked: React.RefObject<boolean>,
  onDone: () => void,
) {
  if (!picked.current) return;
  picked.current = false;
  event.preventDefault();
  onDone();
}

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
  onDone,
}: {
  setup: Setup;
  sendFiles: boolean;
  /** Shown but not usable, while the panel asks for something first. */
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPicked: () => void;
  /** Puts the cursor back in the message input once something is picked. */
  onDone: () => void;
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

  const pickedModel = useRef(false);

  const pick = async (choice: ModelChoice) => {
    pickedModel.current = true;
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
        <PopoverContent
          align="start"
          side="top"
          className="w-75 p-0"
          onCloseAutoFocus={(event) => backToInput(event, pickedModel, onDone)}
        >
          <ModelList
            providers={status.providers}
            models={models}
            value={status.model}
            onPick={(choice) => void pick(choice)}
          />
        </PopoverContent>
      </Popover>
      {picked?.thinking ? (
        <ThinkingButton
          level={picked.thinking}
          disabled={disabled}
          onPicked={onPicked}
          onDone={onDone}
        />
      ) : null}
    </div>
  );
}
