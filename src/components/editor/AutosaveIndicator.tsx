import { CircleCheckIcon, LoaderCircleIcon } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { Hint } from "@/components/ui/tooltip";
import { useEditorStore } from "@/store";

/**
 * The open shard's save state: a check while it's saved, with words only
 * while saving or when changes are waiting.
 */
export function AutosaveIndicator() {
  const { isSaving, isDirty, currentFilePath } = useEditorStore(
    useShallow((s) => ({
      currentFilePath: s.currentFilePath,
      isDirty: s.isDirty,
      isSaving: s.isSaving,
    })),
  );

  if (!currentFilePath) return null;

  if (isSaving) {
    return (
      <span className="flex items-center gap-1.5 px-1 text-ui-sm text-muted-foreground">
        <LoaderCircleIcon className="size-3.5 animate-spin" />
        Saving…
      </span>
    );
  }

  if (isDirty) {
    return (
      <span className="flex items-center gap-1.5 px-1 text-ui-sm text-muted-foreground">
        <span className="size-1.5 rounded-full bg-amber-500" />
        Unsaved changes
      </span>
    );
  }

  return (
    <Hint label="Saved" side="bottom">
      <span
        role="img"
        aria-label="Saved"
        tabIndex={0}
        className="flex size-control items-center justify-center rounded-md text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <CircleCheckIcon className="size-icon" />
      </span>
    </Hint>
  );
}
