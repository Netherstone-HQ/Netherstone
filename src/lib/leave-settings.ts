import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";

/**
 * Closes Settings after an action that's done once handled, like opening a
 * vault, and puts the cursor back in the open shard. Does nothing when
 * Settings isn't open, so the same action elsewhere keeps its place.
 */
export function leaveSettings() {
  const ui = useUIStore.getState();
  if (ui.activeNavItem !== "settings") return;
  ui.openMode("editor");
  // After the editor is back on screen.
  window.requestAnimationFrame(() => {
    const editor = useEditorStore.getState().plateEditor;
    editor?.tf.focus();
  });
}
