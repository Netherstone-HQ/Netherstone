import { useSyncExternalStore } from "react";

import { androidBridge } from "@/lib/android-bridge";
import { IS_ANDROID, IS_MOBILE } from "@/lib/platform";

/**
 * What the phone's own screen parts cover, in CSS px. On Android the app's
 * frame shrinks above the keyboard and MainActivity.kt reports the sizes:
 * `NetherstoneAndroid.insets()` at start, a `systeminsets` event on each change.
 * Elsewhere the page stays full height and the keyboard covers the bottom of
 * the visual viewport.
 *
 * Also set on the root element for CSS: `--keyboard-inset`,
 * `--safe-area-top`, `--safe-area-bottom`.
 */
export type KeyboardState = {
  /** How much of the screen the keyboard covers now, 0 while it's down. */
  inset: number;
  /** The keyboard's height the last time it was up, 0 before that. */
  lastHeight: number;
  /** Whether the page already ends above the keyboard (Android). */
  pageAboveKeyboard: boolean;
};

type Reported = { keyboard?: number; top?: number; bottom?: number };

let state: KeyboardState = {
  inset: 0,
  lastHeight: 0,
  pageAboveKeyboard: IS_ANDROID,
};
const listeners = new Set<() => void>();

const px = (value: number | undefined) =>
  `${Math.max(0, Math.round(value ?? 0))}px`;

/** Records the keyboard's height. */
function setKeyboardInset(inset: number) {
  const next = Math.max(0, Math.round(inset));
  document.documentElement.style.setProperty("--keyboard-inset", px(next));
  if (next === state.inset) return;
  state = {
    ...state,
    inset: next,
    lastHeight: next > 0 ? next : state.lastHeight,
  };
  for (const listener of listeners) listener();
}

function apply(reported: Reported) {
  const root = document.documentElement.style;
  if (reported.top !== undefined)
    root.setProperty("--safe-area-top", px(reported.top));
  if (reported.bottom !== undefined)
    root.setProperty("--safe-area-bottom", px(reported.bottom));
  setKeyboardInset(reported.keyboard ?? 0);
}

function onViewportResize() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  setKeyboardInset(window.innerHeight - viewport.height - viewport.offsetTop);
}

if (typeof window !== "undefined") {
  if (IS_ANDROID) {
    window.addEventListener("systeminsets", (event) =>
      apply((event as CustomEvent<Reported>).detail ?? {}),
    );
    try {
      const reported = androidBridge()?.insets();
      if (reported) apply(JSON.parse(reported) as Reported);
    } catch {
      // An app built before the insets were reported: CSS falls back to env().
    }
  } else if (IS_MOBILE) {
    window.visualViewport?.addEventListener("resize", onViewportResize);
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = () => state;

export function useKeyboard(): KeyboardState {
  return useSyncExternalStore(subscribe, getState, getState);
}
