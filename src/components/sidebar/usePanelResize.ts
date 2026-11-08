import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export interface PanelResizeOptions {
  /** The element whose `cssVar` sets the panel's width. */
  containerRef: RefObject<HTMLElement | null>;
  cssVar: string;
  width: number;
  setWidth: (width: number) => void;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  /** The side of the window the panel is on: dragging away from it widens it. */
  side: "left" | "right";
  /** Told when a drag starts and ends. */
  onDragging?: (dragging: boolean) => void;
}

function clampWidth(width: number, minWidth: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(width)));
}

/**
 * Dragging a side panel's edge to size it. The width shows live through
 * `cssVar` and is kept with `setWidth` when the drag ends.
 */
export function usePanelResize({
  containerRef,
  cssVar,
  width,
  setWidth,
  defaultWidth,
  minWidth,
  maxWidth,
  side,
  onDragging,
}: PanelResizeOptions) {
  const dragWidthRef = useRef(defaultWidth);
  const dragFrameRef = useRef<number | null>(null);
  const didDragRef = useRef(false);
  const latestWidthRef = useRef(width);
  const cleanupDragRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const nextWidth = clampWidth(width, minWidth, maxWidth);
    latestWidthRef.current = nextWidth;
    dragWidthRef.current = nextWidth;
    containerRef.current?.style.setProperty(cssVar, `${nextWidth}px`);
  }, [containerRef, cssVar, maxWidth, minWidth, width]);

  useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
      }
    };
  }, []);

  const setLiveWidth = (next: number) => {
    dragWidthRef.current = clampWidth(next, minWidth, maxWidth);
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      containerRef.current?.style.setProperty(
        cssVar,
        `${dragWidthRef.current}px`,
      );
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0) return;

    const startX = event.clientX;
    const startWidth = dragWidthRef.current;
    const direction = side === "left" ? 1 : -1;
    didDragRef.current = false;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (Math.abs(delta) > 2) didDragRef.current = true;
      setLiveWidth(startWidth + delta * direction);
    };

    const cleanupDrag = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      cleanupDragRef.current = null;
    };

    const handlePointerUp = () => {
      cleanupDrag();
      onDragging?.(false);
      if (dragWidthRef.current !== latestWidthRef.current) {
        setWidth(dragWidthRef.current);
      }
    };

    cleanupDragRef.current = cleanupDrag;
    onDragging?.(true);
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    event.preventDefault();
  };

  const reset = () => {
    setLiveWidth(defaultWidth);
    setWidth(defaultWidth);
  };

  /** Whether the click that ends a drag should be ignored, once. */
  const tookDrag = () => {
    const dragged = didDragRef.current;
    didDragRef.current = false;
    return dragged;
  };

  return { onPointerDown, reset, tookDrag };
}
