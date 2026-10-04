"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { Toolbar } from "./toolbar";

export function FixedToolbar(props: React.ComponentProps<typeof Toolbar>) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    const updateScrollState = () => {
      const maxScrollLeft = element.scrollWidth - element.clientWidth;
      setCanScrollLeft(element.scrollLeft > 4);
      setCanScrollRight(maxScrollLeft - element.scrollLeft > 4);
    };

    updateScrollState();

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });

    resizeObserver.observe(element);
    window.addEventListener("resize", updateScrollState);
    element.addEventListener("scroll", updateScrollState, { passive: true });

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateScrollState);
      element.removeEventListener("scroll", updateScrollState);
    };
  }, []);

  return (
    <div className="sticky top-0 left-0 z-30 overflow-hidden rounded-t-lg border-b border-b-border bg-background/95 backdrop-blur-sm supports-backdrop-blur:bg-background/60">
      <Toolbar
        {...props}
        ref={scrollRef}
        className={cn(
          "w-full justify-between overflow-x-auto p-1",
          "[scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_transparent]",
          "[&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5",
          "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/80",
          "[&::-webkit-scrollbar-track]:bg-transparent",
          props.className,
        )}
      />

      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-background/95 to-transparent transition-opacity duration-150",
          canScrollLeft ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background/95 to-transparent transition-opacity duration-150",
          canScrollRight ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}
