import { createContext, useContext, useEffect } from "react";
import type { SlateEditor } from "platejs";
import { undrawClosedEditor } from "./deferred-chunks";

/**
 * Set for a closed shard's session: removes it from the page. Null while
 * the shard is open.
 */
export const RemoveClosedSessionContext = createContext<(() => void) | null>(
  null,
);

/**
 * Once its shard is closed, undraws `editor` in steps and then removes the
 * session, so no single frame unmounts a whole long shard. Without an
 * editor (it crashed), the session goes at once.
 */
export function RemoveWhenClosed({
  editor,
  blocksPerStep,
}:
  | { editor: SlateEditor; blocksPerStep: number }
  | { editor?: undefined; blocksPerStep?: undefined }) {
  const remove = useContext(RemoveClosedSessionContext);

  useEffect(() => {
    if (!remove) return;
    if (!editor || blocksPerStep === undefined) {
      remove();
      return;
    }

    return undrawClosedEditor(editor, blocksPerStep, remove);
  }, [blocksPerStep, editor, remove]);

  return null;
}
