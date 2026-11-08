import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { usePanelResize } from "./usePanelResize";

export interface LeftSidebarResizeHandleProps {
  containerRef: RefObject<HTMLDivElement | null>;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  className?: string;
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
  const { state, toggleSidebar } = useSidebar();
  const { onPointerDown, reset, tookDrag } = usePanelResize({
    containerRef,
    cssVar: "--sidebar-width",
    width: sidebarWidth,
    setWidth: setSidebarWidth,
    defaultWidth,
    minWidth,
    maxWidth,
    side: "left",
  });

  return (
    <Button
      type="button"
      variant="ghost"
      aria-label="Resize sidebar"
      tabIndex={-1}
      onPointerDown={(event) => {
        if (state === "expanded") onPointerDown(event);
      }}
      onClick={(event) => {
        if (tookDrag()) {
          event.preventDefault();
          return;
        }

        if (state === "collapsed") {
          toggleSidebar();
        }
      }}
      onDoubleClick={reset}
      className={cn(
        "absolute inset-y-0 -right-4 z-20 hidden h-auto w-4 -translate-x-1/2 p-0 transition-all ease-linear sm:flex after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 hover:after:bg-sidebar-border",
        state === "collapsed" ? "cursor-e-resize" : "cursor-w-resize",
        className,
      )}
    />
  );
}
