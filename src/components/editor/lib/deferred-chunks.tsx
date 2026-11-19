import {
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import type { RenderChunkProps, SlateEditor } from "platejs";
import { cancelIdle, requestIdle } from "@/lib/idle-callback";

/** Space an undrawn block holds until it's drawn and measured. */
const UNDRAWN_BLOCK_HEIGHT_PX = 40;

/** How far outside the window an undrawn chunk gets drawn early. */
export const DRAW_AHEAD_MARGIN = "1500px 0px";

const DRAW_IDLE_TIMEOUT_MS = 500;

/** Longest wait for a quiet moment to undraw the next part of a closed shard. */
const UNDRAW_IDLE_TIMEOUT_MS = 1000;

/**
 * Time each idle moment may spend drawing, at least: one frame. Idle moments
 * between frames are short, and each step changes the page, which asks for a
 * frame, so going only by what's left of the moment drew a long shard slowly.
 */
const STEP_BUDGET_MS = 16;

/**
 * A step that draws faster than this draws twice as many blocks next time,
 * one slower than twice this half as many: a shard of short paragraphs
 * isn't drawn as slowly as one of tables.
 */
const STEP_TARGET_MS = 8;
const MAX_STEP_GROWTH = 64;

/**
 * Draws a long shard a part at a time. Rendering every block before showing
 * any took seconds for a shard of hundreds of tables, so the blocks up to
 * `firstBlocks` render right away and the rest in idle moments, in document
 * order. A part about to scroll into view, or one a jump (an outline
 * heading, a link) needs, is drawn at once.
 *
 * The blocks drawn so far are always the first ones: `drawnBlocks` only
 * grows, and a chunk stays drawn once it is, even when edits above it shift
 * its blocks past `drawnBlocks`. Once the shard is closed, it only shrinks
 * (see `undrawInBackground`).
 */
export class ChunkDrawer {
  private drawnBlocks: number;
  private closed = false;
  private readonly listeners = new Set<() => void>();

  constructor(firstBlocks: number) {
    this.drawnBlocks = firstBlocks;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  isDrawn(blockIndex: number) {
    return blockIndex < this.drawnBlocks;
  }

  /** Whether the shard is closed and being undrawn. */
  get isClosed() {
    return this.closed;
  }

  /** Draws every block up to and including `blockIndex`. */
  drawThrough(blockIndex: number) {
    if (this.closed || this.isDrawn(blockIndex)) return;

    this.setDrawnBlocks(blockIndex + 1);
  }

  drawAll() {
    this.drawThrough(Number.MAX_SAFE_INTEGER - 1);
  }

  /**
   * Draws more blocks in idle moments until `blockCount()` are drawn, at
   * least `minBlocksPerStep` at a time, then calls `onComplete`. Returns a
   * function that stops.
   */
  drawInBackground(
    blockCount: () => number,
    minBlocksPerStep: number,
    onComplete?: () => void,
  ) {
    let idleId: number | null = null;
    let blocksPerStep = minBlocksPerStep;

    const drawNext = (deadline: IdleDeadline) => {
      idleId = null;
      if (this.closed) return;

      const idleMs = deadline.didTimeout ? 0 : deadline.timeRemaining();
      const until = performance.now() + Math.max(STEP_BUDGET_MS, idleMs);
      const hasTime = () => performance.now() < until;

      do {
        const count = blockCount();
        if (this.isDrawn(count - 1)) {
          // Blocks added from now on are drawn as they come.
          this.drawAll();
          onComplete?.();
          return;
        }

        // Rendered now, so the time it took counts against this moment.
        const stepStart = performance.now();
        flushSync(() =>
          this.drawThrough(
            Math.min(count, this.drawnBlocks + blocksPerStep) - 1,
          ),
        );
        const stepMs = performance.now() - stepStart;

        if (stepMs < STEP_TARGET_MS) {
          blocksPerStep = Math.min(
            blocksPerStep * 2,
            minBlocksPerStep * MAX_STEP_GROWTH,
          );
        } else if (stepMs > 2 * STEP_TARGET_MS) {
          blocksPerStep = Math.max(
            minBlocksPerStep,
            Math.floor(blocksPerStep / 2),
          );
        }
      } while (hasTime());

      idleId = requestIdle(drawNext, { timeout: DRAW_IDLE_TIMEOUT_MS });
    };

    idleId = requestIdle(drawNext, { timeout: DRAW_IDLE_TIMEOUT_MS });

    return () => {
      if (idleId !== null) cancelIdle(idleId);
    };
  }

  /**
   * For a closed shard: takes its blocks back to placeholders from the end,
   * `blocksPerStep` at a time in idle moments, then calls `onEmpty`.
   * Removing a long shard all at once froze a frame. Nothing is drawn again
   * from then on. Returns a function that stops.
   */
  undrawInBackground(
    blockCount: number,
    blocksPerStep: number,
    onEmpty: () => void,
  ) {
    this.closed = true;
    this.drawnBlocks = Math.min(this.drawnBlocks, blockCount);
    let idleId: number | null = null;

    const undrawNext = (deadline: IdleDeadline) => {
      idleId = null;

      do {
        if (this.drawnBlocks === 0) {
          onEmpty();
          return;
        }

        flushSync(() =>
          this.setDrawnBlocks(Math.max(0, this.drawnBlocks - blocksPerStep)),
        );
      } while (deadline.timeRemaining() > 0);

      idleId = requestIdle(undrawNext, { timeout: UNDRAW_IDLE_TIMEOUT_MS });
    };

    idleId = requestIdle(undrawNext, { timeout: UNDRAW_IDLE_TIMEOUT_MS });

    return () => {
      if (idleId !== null) cancelIdle(idleId);
    };
  }

  private setDrawnBlocks(count: number) {
    this.drawnBlocks = count;
    this.listeners.forEach((listener) => listener());
  }
}

const drawers = new WeakMap<SlateEditor, ChunkDrawer>();

export function registerChunkDrawer(editor: SlateEditor, drawer: ChunkDrawer) {
  drawers.set(editor, drawer);
}

/**
 * Undraws a closed shard's `editor` in steps (see
 * `ChunkDrawer.undrawInBackground`), then calls `onEmpty`. Returns a
 * function that stops.
 */
export function undrawClosedEditor(
  editor: SlateEditor,
  blocksPerStep: number,
  onEmpty: () => void,
) {
  const drawer = drawers.get(editor);
  if (!drawer) {
    onEmpty();
    return undefined;
  }

  return drawer.undrawInBackground(
    editor.children.length,
    blocksPerStep,
    onEmpty,
  );
}

/**
 * Makes sure the top-level block `blockIndex` of `editor` is drawn before
 * something reads its position. Returns false when it wasn't yet: it's drawn
 * by the next frame.
 */
export function drawBlocksThrough(editor: SlateEditor, blockIndex: number) {
  const drawer = drawers.get(editor);
  if (!drawer || drawer.isDrawn(blockIndex)) return true;

  drawer.drawThrough(blockIndex);
  return false;
}

export const ChunkDrawerContext = createContext<ChunkDrawer | null>(null);

type ChunkLeaf = { type: "leaf"; index: number };
type ChunkNode = { type: "chunk"; children: (ChunkNode | ChunkLeaf)[] };

/**
 * The top-level blocks a lowest chunk holds, as indexes. Slate renders a
 * chunk's contents as one element whose `ancestor` prop is the chunk.
 */
function chunkBlockRange(children: ReactNode) {
  if (!isValidElement<{ ancestor?: ChunkNode }>(children)) return null;

  const leaves = children.props.ancestor?.children.filter(
    (child): child is ChunkLeaf => child.type === "leaf",
  );
  if (!leaves?.length) return null;

  return { first: leaves[0].index, last: leaves[leaves.length - 1].index };
}

function DeferredChunk({ attributes, children, lowest }: RenderChunkProps) {
  const drawer = useContext(ChunkDrawerContext);
  const range = lowest ? chunkBlockRange(children) : null;
  const isDrawnNow = useSyncExternalStore(
    drawer?.subscribe ?? noSubscription,
    () => !drawer || !range || drawer.isDrawn(range.first),
  );

  const wasDrawnRef = useRef(false);
  if (isDrawnNow) wasDrawnRef.current = true;
  const isDrawn = drawer?.isClosed ? isDrawnNow : wasDrawnRef.current;

  const placeholderRef = useRef<HTMLDivElement>(null);
  const last = range?.last;

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (isDrawn || !drawer || drawer.isClosed) return;
    if (last === undefined || !placeholder) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          drawer.drawThrough(last);
        }
      },
      { rootMargin: DRAW_AHEAD_MARGIN },
    );
    observer.observe(placeholder);
    return () => observer.disconnect();
  }, [drawer, isDrawn, last]);

  if (!lowest) return children;

  // Distinct keys, so the drawn chunk mounts as a new element: reusing the
  // placeholder's made React remove `contenteditable` from it, which cost
  // more than drawing the chunk.
  if (!isDrawn && range) {
    return (
      <div
        key="undrawn"
        ref={placeholderRef}
        contentEditable={false}
        data-undrawn-chunk=""
        style={{
          height: (range.last - range.first + 1) * UNDRAWN_BLOCK_HEIGHT_PX,
        }}
      />
    );
  }

  // Off screen, a chunk keeps the space its placeholder had until it's
  // measured, so the scrollbar doesn't jump as later parts are drawn.
  const estimate = range
    ? `auto ${(range.last - range.first + 1) * UNDRAWN_BLOCK_HEIGHT_PX}px`
    : undefined;

  return (
    <div
      key="drawn"
      {...attributes}
      style={{ contentVisibility: "auto", containIntrinsicSize: estimate }}
    >
      {children}
    </div>
  );
}

function noSubscription() {
  return () => {};
}

export const renderDeferredChunk = (props: RenderChunkProps) => (
  <DeferredChunk {...props} />
);
