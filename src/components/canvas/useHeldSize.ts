import { useEffect, useRef, useState } from "react";

type Size = { width: number; height: number };

/**
 * The canvas's last real size while its space has collapsed to nothing, as
 * it does while the window is minimized; null otherwise. Excalidraw sizes
 * its toolbar to its container, so without this it switches to its phone
 * layout when minimized and visibly back on restore.
 */
export function useHeldSize(frame: HTMLElement | null) {
  const [held, setHeld] = useState<Size | null>(null);
  const lastSize = useRef<Size | null>(null);

  useEffect(() => {
    if (!frame) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) {
        setHeld(lastSize.current);
        return;
      }
      lastSize.current = { width, height };
      setHeld(null);
    });
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);

  return held;
}
