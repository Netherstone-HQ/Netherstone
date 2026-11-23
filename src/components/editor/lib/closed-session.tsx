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
 * Elements sessions render into, kept for later sessions. React adds its event
 * listeners to an element the first time it renders into it, `wheel` among
 * them, and in WebKit a new `wheel` listener restyles the page root. After
 * WebKit frees memory (every 30 s while a long shard keeps it high), that
 * restyle covers the whole page: about a second with a long shard on it.
 */
const contents: HTMLDivElement[] = [];
const contentBySession = new Map<number, HTMLDivElement>();

/**
 * Sessions that can be on hand at once without a new element: the shard on
 * screen, the one opening, and two closed ones still being taken apart.
 */
const SPARE_CONTENTS = 4;

function newContent() {
  const content = document.createElement("div");
  contents.push(content);
  return content;
}

/** The element `session` renders into: the same one on every render. */
function contentFor(session: number) {
  let content = contentBySession.get(session);
  if (!content) {
    const inUse = new Set(contentBySession.values());
    content = contents.find((free) => !inUse.has(free)) ?? newContent();
    contentBySession.set(session, content);
  }
  return content;
}

/**
 * Makes the spare elements and renders into them while the page is still
 * small (the editor mounts before any shard opens), so React adds its
 * listeners to them then.
 */
export function SpareSessionContents() {
  const [spares] = useState(() => {
    while (contents.length < SPARE_CONTENTS) newContent();
    return [...contents];
  });

  return spares.map((spare, index) => createPortal(null, spare, String(index)));
}

/**
 * Renders a session's shard into an element of its own that leaves the page
 * as soon as the shard is closed, and is taken apart off the page from then
 * on: while a closed long shard was still on the page, each style pass of
 * the next shard cost about three times as much.
 */
export function SessionContent({
  session,
  isClosed,
  children,
}: {
  session: number;
  isClosed: boolean;
  children: ReactNode;
}) {
  const content = contentFor(session);
  // Attached before the shard's own layout effects run, which read the page.
  const attach = useCallback(
    (slot: HTMLDivElement | null) => slot?.append(content),
    [content],
  );

  // Given back once the session is gone; React has emptied it by then.
  useEffect(() => {
    contentBySession.set(session, content);
    return () => {
      contentBySession.delete(session);
    };
  }, [content, session]);

  return (
    <>
      {!isClosed && <div ref={attach} />}
      {createPortal(children, content)}
    </>
  );
}
