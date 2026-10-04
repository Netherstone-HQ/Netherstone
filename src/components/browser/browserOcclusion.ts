import { useEffect } from "react";

/**
 * The browser is a native view drawn above the whole page, so nothing the
 * page draws can appear on top of it. Whenever something should — a menu,
 * a dialog, a toast, or an in-layout overlay such as Settings — the browser
 * pauses: the view hides, and the panel's placeholder, which is always drawn
 * beneath it, shows instead.
 */

// ── In-layout overlays ──────────────────────────────────────────────────────

let layoutOverlayCount = 0;
const layoutOverlayListeners = new Set<() => void>();

function setLayoutOverlayCount(count: number) {
  layoutOverlayCount = count;
  for (const listener of layoutOverlayListeners) listener();
}

export function isLayoutOverlayOpen() {
  return layoutOverlayCount > 0;
}

export function subscribeToLayoutOverlays(listener: () => void) {
  layoutOverlayListeners.add(listener);
  return () => {
    layoutOverlayListeners.delete(listener);
  };
}

/**
 * Pauses the browser while `active`. For overlays rendered inside the app's
 * layout, such as Settings; portals are detected on their own.
 */
export function useCoversBrowser(active = true) {
  useEffect(() => {
    if (!active) return;

    setLayoutOverlayCount(layoutOverlayCount + 1);
    return () => setLayoutOverlayCount(layoutOverlayCount - 1);
  }, [active]);
}

// ── Portals and toasts ──────────────────────────────────────────────────────

/** Body children that are the app itself rather than something over it. */
const APP_ELEMENT_IDS = new Set(["root", "splash"]);
const NON_VISUAL_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE"]);
/** Toasts render inside the app root, not in a portal. */
const TOAST_SELECTOR = "[data-sonner-toast]";
const TOASTER_SELECTOR = "section[aria-live]";

function getOverlayCandidates() {
  const candidates: Element[] = [];

  for (const child of document.body.children) {
    if (APP_ELEMENT_IDS.has(child.id) || NON_VISUAL_TAGS.has(child.tagName)) {
      continue;
    }
    candidates.push(child);
  }

  candidates.push(...document.querySelectorAll(TOAST_SELECTOR));
  return candidates;
}

function intersects(a: DOMRect, b: DOMRect) {
  return (
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
  );
}

interface OverlayState {
  /** Something is painted, whether or not it's over the browser. */
  shown: boolean;
  overlapping: boolean;
}

function inspectOverlay(
  element: Element,
  target: DOMRect,
  depth = 2,
): OverlayState {
  const rect = element.getBoundingClientRect();

  if (rect.width > 0 && rect.height > 0) {
    // Opacity doesn't count as hidden: dialogs and menus open with a fade-in
    // from 0, and a CSS animation never wakes the mutation observer.
    if (getComputedStyle(element).visibility === "hidden") {
      return { shown: false, overlapping: false };
    }
    return { shown: true, overlapping: intersects(rect, target) };
  }

  // Portal wrappers can be zero-sized with fixed-position content inside.
  const state = { shown: false, overlapping: false };
  if (depth === 0) return state;

  for (const child of element.children) {
    const childState = inspectOverlay(child, target, depth - 1);
    state.shown ||= childState.shown;
    state.overlapping ||= childState.overlapping;
  }
  return state;
}

/**
 * Calls `onChange` whenever a portal or toast starts or stops overlapping
 * `viewport`. A new overlay is checked as soon as it's added, before the
 * page paints it. Menus position themselves after they mount and can move,
 * so overlap is then re-checked every frame while anything is shown, and not
 * at all once nothing is.
 */
export function watchOverlays(
  viewport: HTMLElement,
  onChange: (overlapping: boolean) => void,
) {
  let frame = 0;
  let overlapping = false;

  const observer = new MutationObserver(() => check());
  const observeContents = (element: Element) => {
    observer.observe(element, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "data-state"],
    });
  };

  function check() {
    cancelAnimationFrame(frame);
    frame = 0;

    const target = viewport.getBoundingClientRect();
    let shown = false;
    let anyOverlapping = false;

    for (const element of getOverlayCandidates()) {
      // Portal containers can stay mounted and fill up later.
      if (element.parentElement === document.body) observeContents(element);

      const state = inspectOverlay(element, target);
      shown ||= state.shown;
      anyOverlapping ||= state.overlapping;
    }

    if (anyOverlapping !== overlapping) {
      overlapping = anyOverlapping;
      onChange(overlapping);
    }
    if (shown) frame = requestAnimationFrame(check);
  }

  const checkOnNextFrame = () => {
    if (!frame) frame = requestAnimationFrame(check);
  };

  observer.observe(document.body, { childList: true });
  const toaster = document.querySelector(TOASTER_SELECTOR);
  if (toaster) observeContents(toaster);

  // Content revealed by an animation alone changes nothing observable.
  document.addEventListener("animationstart", checkOnNextFrame, true);

  check();

  return () => {
    observer.disconnect();
    document.removeEventListener("animationstart", checkOnNextFrame, true);
    cancelAnimationFrame(frame);
  };
}
