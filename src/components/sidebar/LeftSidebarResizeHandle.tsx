"use client";

import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

export interface LeftSidebarResizeHandleProps {
  containerRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
}

function clampSidebarWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

export function LeftSidebarResizeHandle({
  containerRef,
  sidebarWidth,
  setSidebarWidth,
  defaultWidth = 256,
  minWidth = 256,
  maxWidth = 480,
  className,
}: LeftSidebarResizeHandleProps) {
  const dragWidthRef = useRef(defaultWidth);
  const dragFrameRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const latestSidebarWidthRef = useRef(sidebarWidth);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  const { isMobile, state, toggleSidebar } = useSidebar();

  useEffect(() => {
    const nextWidth = clampSidebarWidth(sidebarWidth, minWidth, maxWidth);
    latestSidebarWidthRef.current = nextWidth;
    dragWidthRef.current = nextWidth;
    containerRef.current?.style.setProperty(
      "--sidebar-width",
      `${nextWidth}px`,
    );
  }, [containerRef, maxWidth, minWidth, sidebarWidth]);

  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();

      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  const setLiveSidebarWidth = (width: number) => {
    dragWidthRef.current = clampSidebarWidth(width, minWidth, maxWidth);

    if (dragFrameRef.current !== null) {
      return;
    }

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      containerRef.current?.style.setProperty(
        "--sidebar-width",
        `${dragWidthRef.current}px`,
      );
    });
  };

  const handleResizePointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      state !== "expanded" ||
      isMobile
    ) {
      return;
    }

    const startX = event.clientX;
    const startWidth = dragWidthRef.current;
    didDragRef.current = false;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;

      if (Math.abs(delta) > 2) {
        didDragRef.current = true;
      }

      setLiveSidebarWidth(startWidth + delta);
    };

    const cleanupDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      cleanupDragRef.current = null;
    };

    const handlePointerUp = () => {
      cleanupDrag();

      if (dragWidthRef.current !== latestSidebarWidthRef.current) {
        setSidebarWidth(dragWidthRef.current);
      }
    };

    cleanupDragRef.current = cleanupDrag;

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    event.preventDefault();
  };

  const handleResetWidth = () => {
    setLiveSidebarWidth(defaultWidth);
    setSidebarWidth(defaultWidth);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      aria-label="Resize Sidebar"
      tabIndex={-1}
      onPointerDown={handleResizePointerDown}
      onClick={(event) => {
        if (didDragRef.current) {
          didDragRef.current = false;
          event.preventDefault();
          return;
        }

        if (state === "collapsed") {
          toggleSidebar();
        }
      }}
      onDoubleClick={handleResetWidth}
      title="Drag to resize sidebar. Double-click to reset width."
      className={cn(
        "absolute inset-y-0 -right-4 z-20 hidden h-auto w-4 -translate-x-1/2 p-0 transition-all ease-linear sm:flex after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 hover:after:bg-sidebar-border",
        state === "collapsed" ? "cursor-e-resize" : "cursor-w-resize",
        className,
      )}
    />
  );
}
