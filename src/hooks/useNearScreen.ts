import { type RefObject, useEffect, useState } from "react";

import { DRAW_AHEAD_MARGIN } from "@/components/editor/lib/deferred-chunks";

/**
 * Whether `ref`'s element is on screen or about to scroll onto it, as far
 * ahead as the editor draws undrawn blocks, so work for it is done in time.
 */
export function useNearScreen(ref: RefObject<Element | null>): boolean {
  const [isNear, setIsNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setIsNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: DRAW_AHEAD_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return isNear;
}
