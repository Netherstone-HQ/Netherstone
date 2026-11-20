import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { SlateEditor } from "platejs";
import { undrawClosedEditor } from "./deferred-chunks";

/**
 * Set for a closed shard's session: removes it from the page. Null while
 * the shard is open.
 */
export const RemoveClosedSessionContext = createContext<(() => void) | null>(
  null,
);

/** Whether this session's shard is closed and on its way out. */
export function useIsSessionClosed() {
  return useContext(RemoveClosedSessionContext) !== null;
}

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

/**
 * Renders a session's shard into an element of its own that leaves the page
 * as soon as the shard is closed, and is taken apart off the page from then
 * on: while a closed long shard was still on the page, each style pass of
 * the next shard cost about three times as much.
 */
export function SessionContent({
  isClosed,
  children,
}: {
  isClosed: boolean;
  children: ReactNode;
}) {
  const [content] = useState(() => document.createElement("div"));
  // Attached before the shard's own layout effects run, which read the page.
  const attach = useCallback(
    (slot: HTMLDivElement | null) => slot?.append(content),
    [content],
  );

  return (
    <>
      {!isClosed && <div ref={attach} />}
      {createPortal(children, content)}
    </>
  );
}
