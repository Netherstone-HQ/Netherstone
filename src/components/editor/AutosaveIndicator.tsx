import { CheckCircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { useShallow } from "zustand/shallow";
import { useEditorStore } from "@/store";

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
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleNotchIcon className="size-3.5 animate-spin" />
        <span>Saving...</span>
      </div>
    );
  }

  if (isDirty) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Unsaved changes</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CheckCircleIcon className="size-3.5" />
      <span>Saved</span>
    </div>
  );
}
