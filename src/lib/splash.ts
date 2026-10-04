// The splash lives in index.html so it paints before any script loads.
// The app lifts it once it has something real to show.

/** The 900 ms animation in index.html, plus a moment to read the lockup. */
const MIN_VISIBLE_MS = 1100;
/** Matches the fade on #splash in index.html, plus a little slack. */
const FADE_MS = 300;

let dismissed = false;
let markLeaving: () => void = () => {};
const leaving = new Promise<void>((resolve) => {
  markLeaving = resolve;
});

/**
 * Resolves as the splash starts to fade out, or right away if there is
 * none, so whatever comes next can arrive as it goes.
 */
export function whenSplashLeaves(): Promise<void> {
  if (!document.getElementById("splash")) return Promise.resolve();
  return leaving;
}

export function dismissSplash() {
  if (dismissed) return;
  dismissed = true;

  const splash = document.getElementById("splash");
  if (!splash) {
    markLeaving();
    return;
  }

  // index.html stamps when the motion started, once the window was shown.
  const start = Number(splash.dataset.start ?? 0);
  const wait = Math.max(0, MIN_VISIBLE_MS - (performance.now() - start));
  window.setTimeout(() => {
    splash.classList.add("is-leaving");
    markLeaving();
    window.setTimeout(() => splash.remove(), FADE_MS);
  }, wait);
}
