import { cancelIdle, requestIdle } from "@/lib/idle-callback";

const MEASURE_IDLE_TIMEOUT_MS = 1000;

/** Chunks whose height is pinned at their current width. */
const pinnedChunks = new WeakSet<HTMLElement>();

/**
 * Editor chunks render with `content-visibility: auto`, so off-screen chunks
 * skip layout and only reserve a placeholder height. When that placeholder is
 * wrong, the scrollbar jumps while scrolling as chunks lay out for real.
 *
 * This measures each chunk's real height during idle time (forcing layout of
 * one chunk at a time) and pins it as the chunk's intrinsic size, so the
 * scroll height is exact shortly after a note opens. A chunk is measured
 * once, and again only when the editor width changes, since that changes
 * how text wraps.
 *
 * Returns a function that stops measuring.
 */
export function measureChunkHeightsInBackground(
  root: HTMLElement,
  options: { onComplete?: () => void } = {},
): () => void {
  let cancelled = false;
  let idleId: number | null = null;
  let queue: HTMLElement[] = [];

  const measureNext = (deadline: IdleDeadline) => {
    idleId = null;
    if (cancelled) return;

    do {
      const chunk = queue.shift();

      if (!chunk) {
        options.onComplete?.();
        return;
      }

      if (!chunk.isConnected || pinnedChunks.has(chunk)) continue;

      pinChunkHeight(chunk);
    } while (deadline.timeRemaining() > 10);

    idleId = requestIdle(measureNext, { timeout: MEASURE_IDLE_TIMEOUT_MS });
  };

  const measureAll = ({ unpin }: { unpin: boolean }) => {
    queue = Array.from(root.querySelectorAll<HTMLElement>("[data-slate-chunk]"));
    if (unpin) queue.forEach((chunk) => pinnedChunks.delete(chunk));

    if (idleId === null) {
      idleId = requestIdle(measureNext, { timeout: MEASURE_IDLE_TIMEOUT_MS });
    }
  };

  measureAll({ unpin: false });

  let lastWidth = root.clientWidth;
  const resizeObserver = new ResizeObserver(() => {
    const width = root.clientWidth;
    // Height changes from editing don't affect other chunks; width changes
    // re-wrap text everywhere.
    if (Math.abs(width - lastWidth) < 1) return;

    lastWidth = width;
    measureAll({ unpin: true });
  });
  resizeObserver.observe(root);

  return () => {
    cancelled = true;
    if (idleId !== null) cancelIdle(idleId);
    resizeObserver.disconnect();
  };
}

/**
 * Pins the heights of the chunks above `el`, so its position is final: a
 * jump to it then lands where it is, not where placeholder heights put it.
 */
export function pinChunkHeightsAbove(el: HTMLElement) {
  const chunk = el.closest<HTMLElement>("[data-slate-chunk]");
  const root = chunk?.closest<HTMLElement>("[data-slate-editor]");
  if (!chunk || !root) return;

  const chunks = root.querySelectorAll<HTMLElement>("[data-slate-chunk]");
  for (const other of chunks) {
    if (other === chunk) return;
    if (!pinnedChunks.has(other)) pinChunkHeight(other);
  }
}

/**
 * Pins `chunk`'s real height as its intrinsic size, which it keeps while
 * `content-visibility: auto` skips it. Returns the height.
 *
 * A chunk the browser skips is laid out for the read. One it draws (on
 * screen) is read as it is: setting `content-visibility` back to `auto`
 * skips it until the next frame, and a click in that frame put the caret
 * at the top of the shard.
 */
export function pinChunkHeight(chunk: HTMLElement) {
  pinnedChunks.add(chunk);
  const skipped = !chunk.firstElementChild?.checkVisibility?.({
    contentVisibilityAuto: true,
  });
  if (skipped) chunk.style.contentVisibility = "visible";
  const height = Math.round(chunk.getBoundingClientRect().height);
  chunk.style.containIntrinsicSize = `auto ${height}px`;
  if (skipped) chunk.style.contentVisibility = "auto";
  return height;
}
