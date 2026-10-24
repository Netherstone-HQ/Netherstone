import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/** Asks for the next page once it comes within a screen of view. */
export function NextPageTrigger({
  scrollRoot,
  onReach,
  className,
}: {
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  onReach: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) onReach();
      },
      { root: scrollRoot.current, rootMargin: "100% 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [scrollRoot, onReach]);

  return <li ref={ref} aria-hidden="true" className={cn("h-px", className)} />;
}
