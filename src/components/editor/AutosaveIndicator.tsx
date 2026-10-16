import { SaveStatus } from "@/components/SaveStatus";
import { useEditorStore } from "@/store";

/** The open shard's save state. */
export function AutosaveIndicator() {
  const state = useEditorStore((s) =>
    !s.currentFilePath
      ? null
      : s.isSaving
        ? "saving"
        : s.isDirty
          ? "unsaved"
          : "saved",
  );

  return state ? <SaveStatus state={state} /> : null;
}
