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
const DRAW_AHEAD_MARGIN = "1500px 0px";

const DRAW_IDLE_TIMEOUT_MS = 500;

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
 * its blocks past `drawnBlocks`.
 */
export class ChunkDrawer {
  private drawnBlocks: number;
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

  /** Draws every block up to and including `blockIndex`. */
  drawThrough(blockIndex: number) {
    if (this.isDrawn(blockIndex)) return;

    this.drawnBlocks = blockIndex + 1;
    this.listeners.forEach((listener) => listener());
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
}

const drawers = new WeakMap<SlateEditor, ChunkDrawer>();

export function registerChunkDrawer(editor: SlateEditor, drawer: ChunkDrawer) {
  drawers.set(editor, drawer);
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
  const isDrawn = wasDrawnRef.current;

  const placeholderRef = useRef<HTMLDivElement>(null);
  const last = range?.last;

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (isDrawn || !drawer || last === undefined || !placeholder) return;

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

  if (!isDrawn && range) {
    return (
      <div
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
