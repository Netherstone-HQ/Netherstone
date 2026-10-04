// WebKit webviews (WebKitGTK on Linux, WKWebView on macOS) don't implement
// requestIdleCallback, so these fall back to running right after the next
// paint there.

/** The time between paints the fallback assumes: one 60 Hz frame. */
const FRAME_MS = 16;

interface PendingFallback {
  frame: number;
  timer: number;
  deadlineTimer: number;
}

const pendingFallbacks = new Map<number, PendingFallback>();
let nextFallbackId = 1;

function hasIdleCallback() {
  return (
    typeof window.requestIdleCallback === "function" &&
    typeof window.cancelIdleCallback === "function"
  );
}

function clearFallback(pending: PendingFallback) {
  cancelAnimationFrame(pending.frame);
  window.clearTimeout(pending.timer);
  window.clearTimeout(pending.deadlineTimer);
}

/**
 * `requestIdleCallback`, or where it's missing, a callback right after the
 * next paint.
 *
 * A timeout queued from an animation frame runs once that frame has been
 * painted, so the callback gets what's left of the frame instead of
 * competing with it, and `timeRemaining()` reports that leftover. Running
 * work on a short timeout instead let several slices land in one frame and
 * push it past its deadline while the app was busy.
 *
 * Like the native API, `options.timeout` runs the callback anyway, with
 * `didTimeout`, if no frame comes in time (a hidden window paints none).
 */
export function requestIdle(
  callback: IdleRequestCallback,
  options?: IdleRequestOptions,
): number {
  if (hasIdleCallback()) return window.requestIdleCallback(callback, options);

  const id = nextFallbackId++;
  const pending: PendingFallback = { frame: 0, timer: 0, deadlineTimer: 0 };

  const run = (didTimeout: boolean, frameStart: number) => {
    if (!pendingFallbacks.delete(id)) return;
    clearFallback(pending);
    callback({
      didTimeout,
      timeRemaining: () =>
        Math.max(0, frameStart + FRAME_MS - performance.now()),
    });
  };

  pending.frame = requestAnimationFrame((frameStart) => {
    pending.timer = window.setTimeout(() => run(false, frameStart), 0);
  });
  if (options?.timeout !== undefined) {
    pending.deadlineTimer = window.setTimeout(
      () => run(true, performance.now()),
      options.timeout,
    );
  }

  pendingFallbacks.set(id, pending);
  return id;
}

/** Cancels a callback scheduled with `requestIdle`. */
export function cancelIdle(id: number): void {
  if (hasIdleCallback()) {
    window.cancelIdleCallback(id);
    return;
  }

  const pending = pendingFallbacks.get(id);
  if (!pending) return;
  pendingFallbacks.delete(id);
  clearFallback(pending);
}
