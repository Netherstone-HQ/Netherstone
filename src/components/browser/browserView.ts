import {
  type BrowserBounds,
  setBrowserWebviewBounds,
  setBrowserWebviewVisible,
} from "@/components/browser/browserCommands";
import {
  isLayoutOverlayOpen,
  subscribeToLayoutOverlays,
  watchOverlays,
} from "@/components/browser/browserOcclusion";

/**
 * The element's box in device pixels. Edges are rounded, not sizes: rounding
 * position and size apart lets the far edge drift a pixel from frame to frame.
 */
export function getElementPhysicalBounds(element: HTMLElement): BrowserBounds {
  const rect = element.getBoundingClientRect();
  const scale = window.devicePixelRatio;
  const left = Math.round(rect.left * scale);
  const top = Math.round(rect.top * scale);

  return {
    x: left,
    y: top,
    width: Math.max(0, Math.round(rect.right * scale) - left),
    height: Math.max(0, Math.round(rect.bottom * scale) - top),
  };
}

function isSameBounds(a: BrowserBounds | null, b: BrowserBounds) {
  return (
    a !== null &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

/**
 * Keeps a native browser view over its panel's `viewport` element.
 *
 * The view follows the panel's size, and pauses — hides, uncovering the
 * placeholder drawn beneath it — while anything is drawn over the panel or
 * the panel isn't on screen.
 */
export class BrowserViewController {
  /** What the native side was last told. The view starts visible. */
  private placed: BrowserBounds | null = null;
  private visible = true;
  /** The panel's box as last measured. */
  private bounds: BrowserBounds | null = null;
  private overlayOver = false;
  private seq = 0;
  private syncingVisibility = false;
  private disposed = false;
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly label: string,
    private readonly viewport: HTMLElement,
  ) {}

  start() {
    // Only the panel's size can move it (panels are sized in percentages),
    // and a resize observer reports right after layout, so measuring there
    // never forces an extra layout of the rest of the app.
    const resizeObserver = new ResizeObserver(() => this.measure());
    resizeObserver.observe(this.viewport);
    this.stops.push(() => resizeObserver.disconnect());

    this.stops.push(this.watchDisplayScale());

    this.stops.push(
      watchOverlays(this.viewport, (overlapping) => {
        this.overlayOver = overlapping;
        this.update();
      }),
    );
    this.stops.push(subscribeToLayoutOverlays(() => this.update()));

    this.measure();
  }

  dispose() {
    this.disposed = true;
    for (const stop of this.stops.splice(0)) stop();
  }

  get isPaused() {
    return this.overlayOver || isLayoutOverlayOpen();
  }

  /** A new display scale moves every device-pixel edge without resizing. */
  private watchDisplayScale() {
    let query: MediaQueryList | null = null;

    const onChange = () => {
      this.measure();
      watch();
    };
    const watch = () => {
      query?.removeEventListener("change", onChange);
      query = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener("change", onChange);
    };

    watch();
    return () => query?.removeEventListener("change", onChange);
  }

  private measure() {
    this.bounds = getElementPhysicalBounds(this.viewport);
    this.update();
  }

  private shouldShow() {
    const bounds = this.bounds;
    return (
      bounds !== null && bounds.width > 0 && bounds.height > 0 && !this.isPaused
    );
  }

  private update() {
    if (this.disposed || !this.bounds) return;

    const show = this.shouldShow();

    // While paused or off screen the view stays where it was; it's moved
    // to the latest box just before it shows again.
    if (show && !isSameBounds(this.placed, this.bounds)) {
      this.place(this.bounds);
    }
    if (show !== this.visible) void this.syncVisibility();
  }

  /**
   * Sent without waiting for the last placement to land: waiting made them
   * arrive on uneven frames. Each is numbered so a late one is dropped.
   */
  private place(bounds: BrowserBounds) {
    this.placed = bounds;
    setBrowserWebviewBounds(bounds, ++this.seq, this.label).catch((error) => {
      this.placed = null;
      console.error("Failed to place browser webview:", error);
    });
  }

  /**
   * Shows or hides the view, one call at a time, re-reading the target after
   * each so the latest state wins.
   */
  private async syncVisibility() {
    if (this.syncingVisibility) return;
    this.syncingVisibility = true;

    try {
      while (!this.disposed) {
        const show = this.shouldShow();
        if (show === this.visible) break;

        await setBrowserWebviewVisible(show, this.label);
        this.visible = show;
      }
    } catch (error) {
      console.error("Failed to show or hide browser webview:", error);
    } finally {
      this.syncingVisibility = false;
    }
  }
}
