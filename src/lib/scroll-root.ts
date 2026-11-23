/**
 * Nearest scrollable ancestor (the element that actually moves when the user
 * scrolls the document): `<main>` for the open shard; an editor elsewhere
 * may scroll a box of its own.
 */
export function findScrollableAncestor(
  start: HTMLElement | null,
): HTMLElement | null {
  let el: HTMLElement | null = start;

  while (el) {
    const { overflowY } = window.getComputedStyle(el);
    const canScrollY =
      (overflowY === "auto" ||
        overflowY === "scroll" ||
        overflowY === "overlay") &&
      el.scrollHeight > el.clientHeight + 1;

    if (canScrollY) {
      return el;
    }

    el = el.parentElement;
  }

  return null;
}
