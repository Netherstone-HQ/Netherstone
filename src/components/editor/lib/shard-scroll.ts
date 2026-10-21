import { useEffect, useLayoutEffect, useRef } from "react";
import type { SlateEditor } from "platejs";
import { getRenderedRect, getStickyTopInset } from "@/lib/plate-toc-headings";
import { useEditorStore } from "@/store";
import {
  type ShardScrollPosition,
  useShardScrollStore,
} from "@/store/shard-scroll";

/** How long scrolling has to pause before the place is written down. */
const SAVE_DELAY_MS = 400;

/** Rows tried below the toolbar when the first lands between two blocks. */
const PROBE_STEP_PX = 12;
const PROBE_COUNT = 6;

const TOP: ShardScrollPosition = { block: 0, offset: 0 };

/**
 * Places read but not written down yet, by path. A closed shard is removed
 * from the page a moment after the next one is shown, so its last place may
 * still be here when it's opened again.
 */
const unsavedPositions = new Map<string, ShardScrollPosition>();

function keyOf(path: string) {
  return path.replace(/\\/g, "/");
}

/** Where the shard at `path` was left, if it was opened before. */
export function getShardScrollPosition(path: string) {
  return (
    unsavedPositions.get(keyOf(path)) ??
    useShardScrollStore.getState().getPosition(path)
  );
}

/** The top-level block a DOM element is in, as an index. */
function topLevelBlockIndex(editor: SlateEditor, el: Element) {
  const root = editor.api.toDOMNode(editor);
  if (!root?.contains(el)) return null;

  let block: Element | null = el.closest('[data-slate-node="element"]');
  while (block) {
    const outer = block.parentElement?.closest('[data-slate-node="element"]');
    if (!outer || !root.contains(outer)) break;
    block = outer;
  }
  if (!block) return null;

  const node = editor.api.toSlateNode(block);
  const index = node ? editor.children.indexOf(node as never) : -1;
  return index >= 0 ? { index, el: block as HTMLElement } : null;
}

/** Where `scroller` is in the shard: the block at the top of the window. */
export function readScrollPosition(
  editor: SlateEditor,
  scroller: HTMLElement,
): ShardScrollPosition | null {
  if (scroller.scrollTop < 1) return TOP;

  const root = editor.api.toDOMNode(editor);
  if (!root) return null;

  const scrollerRect = scroller.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  // Just inside the text column's left edge: blocks start there, while
  // narrow ones (a small table) don't reach the middle.
  const x =
    rootRect.left + (parseFloat(getComputedStyle(root).paddingLeft) || 0) + 4;
  const top = scrollerRect.top + getStickyTopInset(scroller);

  for (let probe = 0; probe < PROBE_COUNT; probe++) {
    const y = top + 1 + probe * PROBE_STEP_PX;
    const hit = document
      .elementsFromPoint(x, y)
      .map((el) => topLevelBlockIndex(editor, el))
      .find((found) => found !== null);
    if (!hit) continue;

    return {
      block: hit.index,
      offset: Math.round(scrollerRect.top - hit.el.getBoundingClientRect().top),
    };
  }

  return null;
}

/** Scrolls `scroller` so `position`'s block is where it was. */
export function applyScrollPosition(
  editor: SlateEditor,
  scroller: HTMLElement,
  position: ShardScrollPosition,
) {
  const node =
    editor.children[Math.min(position.block, editor.children.length - 1)];
  const el = node ? editor.api.toDOMNode(node) : null;

  if (position.block === 0 || !el) {
    scroller.scrollTop = position.block === 0 ? position.offset : 0;
    return;
  }

  const blockTop = getRenderedRect(el).top;
  scroller.scrollTop +=
    blockTop - scroller.getBoundingClientRect().top + position.offset;
}

/**
 * Keeps each shard's place: it opens where it was left, also after a
 * restart, and comes back there when the window is restored after being
 * minimized (the editor shrinks to nothing then, which loses the scroll) or
 * the editor is shown again after another view.
 *
 * `restore` is false when something else scrolls the shard on open, such as
 * a link the Overview asked for.
 */
export function useShardScroll(
  editor: SlateEditor,
  filePath: string,
  savedPosition: ShardScrollPosition | null,
  restore: boolean,
) {
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  // The place to come back to when the editor is shown again.
  const positionRef = useRef(savedPosition ?? TOP);

  useLayoutEffect(() => {
    const scroller = editor.api.toDOMNode(editor)?.closest("main");
    if (scroller && restore) {
      applyScrollPosition(editor, scroller, positionRef.current);
    }
    // Only when the shard opens.
  }, [editor]);

  useEffect(() => {
    const scroller = editor.api.toDOMNode(editor)?.closest("main");
    if (!scroller) return;

    const isCurrent = () => useEditorStore.getState().plateEditor === editor;
    const isShown = () => scroller.clientHeight >= 1;

    let frame: number | null = null;
    let saveTimer: number | null = null;
    let unsavedKey: string | null = null;

    const save = () => {
      if (saveTimer !== null) window.clearTimeout(saveTimer);
      saveTimer = null;
      if (unsavedKey !== null) unsavedPositions.delete(unsavedKey);
      unsavedKey = null;
      useShardScrollStore
        .getState()
        .setPosition(filePathRef.current, positionRef.current);
    };

    const onScroll = () => {
      if (frame !== null) return;

      frame = window.requestAnimationFrame(() => {
        frame = null;
        // A hidden or minimized editor has no height, and the browser
        // scrolls it to the top: that isn't where the reader is.
        if (!isCurrent() || !isShown()) return;

        const position = readScrollPosition(editor, scroller);
        if (!position) return;

        positionRef.current = position;
        if (unsavedKey !== null) unsavedPositions.delete(unsavedKey);
        unsavedKey = keyOf(filePathRef.current);
        unsavedPositions.set(unsavedKey, position);
        if (saveTimer !== null) window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(save, SAVE_DELAY_MS);
      });
    };

    let wasShown = isShown();
    const resizeObserver = new ResizeObserver(() => {
      const shown = isShown();
      if (shown && !wasShown && isCurrent()) {
        applyScrollPosition(editor, scroller, positionRef.current);
      }
      wasShown = shown;
    });

    // Closing the app shouldn't lose the last moment of scrolling.
    const onPageHide = () => {
      if (saveTimer !== null) save();
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);
    resizeObserver.observe(scroller);

    return () => {
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      resizeObserver.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
      if (saveTimer !== null) save();
    };
  }, [editor]);
}
