import { cancelIdle, requestIdle } from "@/lib/idle-callback";

const MEASURE_IDLE_TIMEOUT_MS = 1000;

/**
 * Editor chunks render with `content-visibility: auto`, so off-screen chunks
 * skip layout and only reserve a placeholder height. When that placeholder is
 * wrong, the scrollbar jumps while scrolling as chunks lay out for real.
 *
 * This measures each chunk's real height during idle time (forcing layout of
 * one chunk at a time) and pins it as the chunk's intrinsic size, so the
 * scroll height is exact shortly after a note opens. Chunks are re-measured
 * when the editor width changes, since that changes how text wraps.
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

      if (!chunk.isConnected) continue;

      chunk.style.contentVisibility = "visible";
      const height = chunk.getBoundingClientRect().height;
      chunk.style.containIntrinsicSize = `auto ${Math.round(height)}px`;
      chunk.style.contentVisibility = "auto";
    } while (deadline.timeRemaining() > 10);

    idleId = requestIdle(measureNext, { timeout: MEASURE_IDLE_TIMEOUT_MS });
  };

  const measureAll = () => {
    queue = Array.from(root.querySelectorAll<HTMLElement>("[data-slate-chunk]"));

    if (idleId === null) {
      idleId = requestIdle(measureNext, { timeout: MEASURE_IDLE_TIMEOUT_MS });
    }
  };

  measureAll();

  let lastWidth = root.clientWidth;
  const resizeObserver = new ResizeObserver(() => {
    const width = root.clientWidth;
    // Height changes from editing don't affect other chunks; width changes
    // re-wrap text everywhere.
    if (Math.abs(width - lastWidth) < 1) return;

    lastWidth = width;
    measureAll();
  });
  resizeObserver.observe(root);

  return () => {
    cancelled = true;
    if (idleId !== null) cancelIdle(idleId);
    resizeObserver.disconnect();
  };
}
