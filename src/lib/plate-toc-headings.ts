import type { Heading } from "@platejs/toc";
import { BaseTocPlugin, isHeading } from "@platejs/toc";
import { KEYS, NodeApi, type SlateEditor, type TElement } from "platejs";

const headingDepth: Record<string, number> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

/**
 * Same heading discovery as `@platejs/toc` / the in-editor TOC block, so the
 * right sidebar stays in sync with the live document (not the file on disk).
 */
export function getPlateHeadingList(editor: SlateEditor): Heading[] {
  const options = editor.getOptions(BaseTocPlugin);

  if (options.queryHeading) {
    return options.queryHeading(editor);
  }

  const headingList: Heading[] = [];

  // Prefer Plate's node iterator when available.
  try {
    const values = editor.api.nodes<TElement>({
      at: [],
      match: (n) => isHeading(n),
    });

    if (values) {
      for (const [node, path] of values) {
        const { type } = node;
        const title = NodeApi.string(node);
        const depth = headingDepth[type] ?? 1;
        const id = (node as any).id as string | undefined;

        if (title) {
          headingList.push({
            id: id ?? `${type}-${path.join("-")}`,
            depth,
            path,
            title,
            type,
          });
        }
      }

      return headingList;
    }
  } catch {
    // Fall through to manual traversal.
  }

  // Manual traversal fallback. This is more resilient during early mount when
  // `editor.api` can be in a partially initialized state.
  const walk = (nodes: unknown, path: number[]) => {
    if (!Array.isArray(nodes)) return;

    nodes.forEach((node, index) => {
      if (!node || typeof node !== "object") return;

      const record = node as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type : null;
      const children = record.children;
      const nextPath = [...path, index];

      if (type && (KEYS as any).heading?.includes?.(type)) {
        const title = NodeApi.string(node as any);
        const depth = headingDepth[type] ?? 1;
        const id = typeof record.id === "string" ? record.id : `${type}-${nextPath.join("-")}`;
        if (title) {
          headingList.push({ id, depth, path: nextPath, title, type });
        }
      }

      walk(children, nextPath);
    });
  };

  walk(editor.children as any, []);
  return headingList;
}

/**
 * Nearest scrollable ancestor (the element that actually moves when the user
 * scrolls the document). Plate uses an inner `PlateContainer` with
 * `overflow-y-auto`, not always `<main>`.
 */
function findScrollableAncestor(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start;

  while (el) {
    const { overflowY } = window.getComputedStyle(el);
    const canScrollY =
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + 1;

    if (canScrollY) {
      return el;
    }

    el = el.parentElement;
  }

  return null;
}

/** Sticky UI (e.g. fixed toolbar) inside the same scroll root as the heading. */
function getStickyTopInset(scrollRoot: HTMLElement): number {
  const stickies = scrollRoot.querySelectorAll<HTMLElement>(".sticky");
  let max = 0;

  stickies.forEach((node) => {
    const top = window.getComputedStyle(node).top;
    if (top === "0px" || top === "0") {
      max = Math.max(max, node.getBoundingClientRect().height);
    }
  });

  return max;
}

/**
 * Bounding rect of an element that may sit in an editor chunk skipped by
 * `content-visibility: auto`. A chunk that was never laid out has no real
 * position for its contents, so lay it out for this one read.
 */
function getRenderedRect(el: HTMLElement): DOMRect {
  const chunk = el.closest<HTMLElement>("[data-slate-chunk]");
  if (!chunk) return el.getBoundingClientRect();

  const previousContentVisibility = chunk.style.contentVisibility;
  chunk.style.contentVisibility = "visible";
  const rect = el.getBoundingClientRect();
  chunk.style.contentVisibility = previousContentVisibility;

  return rect;
}

/** Upper bound for waiting on `scrollend` (it never fires if nothing scrolls). */
const SCROLL_SETTLE_TIMEOUT_MS = 1000;

let latestScrollRequestId = 0;

/** Match `@platejs/toc` click behavior: scroll the editor’s heading into view. */
export function scrollPlateToHeading(
  editor: SlateEditor,
  heading: Heading,
  behavior: ScrollBehavior = "smooth",
) {
  const node = NodeApi.get(editor, heading.path);
  if (!node) return;

  const el = editor.api.toDOMNode(node);
  if (!el || !(el instanceof HTMLElement)) return;

  const pluginOffset = editor.getOptions(BaseTocPlugin).topOffset ?? 80;

  const scrollRoot =
    findScrollableAncestor(el) ??
    el.closest<HTMLElement>("main") ??
    el.closest<HTMLElement>("[data-slate-editor]")?.parentElement;

  // Focusing an unfocused editor restores its previous caret, and Slate then
  // scrolls that caret into view, cancelling this scroll (so the first click
  // only focused the editor). Put the caret on the heading once the scroll
  // has settled; it's in view by then, so Slate has nothing left to scroll.
  let didFocus = false;
  const requestId = ++latestScrollRequestId;
  const focusHeading = () => {
    // A newer click superseded this one; moving the caret here would scroll
    // back to this heading.
    if (didFocus || requestId !== latestScrollRequestId) return;
    didFocus = true;

    const start = editor.api.start(heading.path);
    if (start) editor.tf.select(start);
    editor.tf.focus();
  };

  if (scrollRoot && scrollRoot.scrollHeight > scrollRoot.clientHeight) {
    const stickyInset = getStickyTopInset(scrollRoot);
    // Place the heading just below the sticky toolbar + gap, or use plugin
    // `topOffset` when there is no sticky toolbar in this scroller.
    const gapPx = 12;
    const topOffset =
      stickyInset > 0 ? stickyInset + gapPx : Math.max(48, pluginOffset);

    const rootRect = scrollRoot.getBoundingClientRect();
    const elRect = getRenderedRect(el);
    const nextTop = Math.max(
      0,
      scrollRoot.scrollTop + (elRect.top - rootRect.top) - topOffset,
    );

    if (Math.abs(nextTop - scrollRoot.scrollTop) < 1) {
      focusHeading();
      return;
    }

    scrollRoot.addEventListener("scrollend", focusHeading, { once: true });
    window.setTimeout(focusHeading, SCROLL_SETTLE_TIMEOUT_MS);
    scrollRoot.scrollTo({ top: nextTop, behavior });
  } else {
    el.scrollIntoView({ behavior, block: "start" });
    window.setTimeout(focusHeading, SCROLL_SETTLE_TIMEOUT_MS);
  }
}
