import {
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { flushSync } from "react-dom";
import {
  createSlatePlugin,
  type RenderChunkProps,
  type SlateEditor,
} from "platejs";
import { cancelIdle, requestIdle } from "@/lib/idle-callback";
import { findScrollableAncestor } from "@/lib/scroll-root";
import { pinChunkHeight } from "./chunk-heights";

/**
 * Space an undrawn block holds until it's drawn and measured. A shard past
 * the drawn-element limit then uses what its first drawn blocks take.
 */
const UNDRAWN_BLOCK_HEIGHT_PX = 40;

/** How far outside the window an undrawn chunk gets drawn early. */
const DRAW_AHEAD_PX = 1500;
export const DRAW_AHEAD_MARGIN = `${DRAW_AHEAD_PX}px 0px`;

/**
 * Shards with up to this many elements stay fully drawn. In the Linux app a
 * drawn element holds about 65 KB (script, page and style memory, measured
 * on the bench shards), so this is about 1.2 GB: under the 1.5 GB past
 * which WebKit frees memory every 30 s. The 390 KB bench shard (about 8,500
 * elements) stays fully drawn.
 */
export const MAX_FULLY_DRAWN_ELEMENTS = 10_000;

/**
 * Most elements a longer shard keeps drawn, the parts nearest the screen.
 * Lower than the above: drawing and undrawing leaves memory behind for a
 * while (about 250 MB measured on the 1.3 MB bench shard).
 */
export const MAX_DRAWN_ELEMENTS = 6_000;

/**
 * Past the limit, the parts farthest from the screen are undrawn until this
 * share of it is left, so drawing near the screen doesn't undraw on every
 * step.
 */
const UNDRAW_DOWN_TO = 0.9;

const TRIM_IDLE_TIMEOUT_MS = 1000;

/** Whether `blocks` hold more elements than a shard keeps fully drawn. */
export function isPastDrawnLimit(blocks: readonly unknown[]) {
  let count = 0;
  const visit = (node: unknown): boolean => {
    const children = (node as { children?: unknown[] }).children;
    if (!children) return false;
    count += 1;
    return count > MAX_FULLY_DRAWN_ELEMENTS || children.some(visit);
  };
  return blocks.some(visit);
}

/** A drawn lowest chunk, or one undrawn again for the limit. */
export type TrackedChunk = {
  first: number;
  last: number;
  /** Elements it holds while drawn. */
  elements: number;
  isUndrawn: boolean;
  element: HTMLElement | null;
  undraw: () => void;
  redraw: () => void;
};

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
 * (see `undrawInBackground`). The exception is a shard past the
 * drawn-element limit: every block counts as reached, and each chunk is
 * drawn and undrawn on its own, by how near the screen it is.
 */
export class ChunkDrawer {
  private drawnBlocks: number;
  private closed = false;
  private readonly listeners = new Set<() => void>();
  private editor: SlateEditor | null = null;
  private readonly chunks = new Set<TrackedChunk>();
  private trimId: number | null = null;
  /** Too long to draw fully: only the parts near the screen stay drawn. */
  private isLimited: boolean;
  /** Space an undrawn block holds, once some are drawn: as much as they do. */
  private blockHeight = UNDRAWN_BLOCK_HEIGHT_PX;
  /** With the limit, the blocks drawn when the shard opens. */
  private readonly firstDrawn: { from: number; to: number };

  /**
   * Draws blocks up to `firstBlocks` first. A shard past the drawn-element
   * limit (see `isPastDrawnLimit`) draws only from `limitedFrom` up to
   * there, and later only what comes near the screen: drawing it all once
   * took WebKit past 1.5 GB, and its memory release then left every style
   * to redo on the next jump (about 1 s).
   */
  constructor(firstBlocks: number, limitedFrom?: number) {
    this.isLimited = limitedFrom !== undefined;
    this.firstDrawn = { from: limitedFrom ?? 0, to: firstBlocks };
    this.drawnBlocks = this.isLimited ? Number.MAX_SAFE_INTEGER : firstBlocks;
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

  attach(editor: SlateEditor) {
    this.editor = editor;
  }

  /** Whether only the parts near the screen stay drawn, for the limit. */
  get drawsNearScreenOnly() {
    return this.isLimited;
  }

  /** Space a block not drawn yet holds, in pixels. */
  get undrawnBlockHeight() {
    return this.blockHeight;
  }

  /** Whether the chunk of blocks `first` to `last` starts as a placeholder. */
  startsUndrawn(first: number, last: number) {
    return (
      this.isLimited &&
      (last < this.firstDrawn.from || first >= this.firstDrawn.to)
    );
  }

  /** Elements in the top-level blocks `first` to `last`, the blocks included. */
  countElements(first: number, last: number) {
    let count = 0;
    const visit = (node: unknown) => {
      const children = (node as { children?: unknown[] }).children;
      if (!children) return;
      count += 1;
      children.forEach(visit);
    };
    this.editor?.children.slice(first, last + 1).forEach(visit);
    return count;
  }

  /**
   * Keeps count of a lowest chunk while it's drawn or undrawn for the limit.
   * Returns a function that stops.
   */
  track(chunk: TrackedChunk) {
    this.chunks.add(chunk);
    if (!chunk.isUndrawn) this.scheduleTrim();
    return () => {
      this.chunks.delete(chunk);
    };
  }

  /** Whether block `blockIndex` was drawn and is undrawn again for the limit. */
  isUndrawnAgain(blockIndex: number) {
    return !!this.undrawnChunkAt(blockIndex);
  }

  /** Draws again the chunk holding `blockIndex`, if it was undrawn for the limit. */
  redrawAt(blockIndex: number) {
    this.undrawnChunkAt(blockIndex)?.redraw();
  }

  /**
   * Draws again the chunks the selection starts and ends in: the editor
   * puts the caret into the page right after a change.
   */
  keepSelectionDrawn() {
    const selection = this.editor?.selection;
    if (!selection) return;
    this.redrawAt(selection.anchor.path[0]);
    this.redrawAt(selection.focus.path[0]);
  }

  private undrawnChunkAt(blockIndex: number) {
    for (const chunk of this.chunks) {
      if (
        chunk.isUndrawn &&
        chunk.first <= blockIndex &&
        blockIndex <= chunk.last
      ) {
        return chunk;
      }
    }
    return undefined;
  }

  private drawnElements() {
    let count = 0;
    for (const chunk of this.chunks)
      if (!chunk.isUndrawn) count += chunk.elements;
    return count;
  }

  private scheduleTrim() {
    if (this.closed || this.trimId !== null) return;
    const drawn = this.drawnElements();
    if (drawn > MAX_FULLY_DRAWN_ELEMENTS) this.isLimited = true;
    if (!this.isLimited || drawn <= MAX_DRAWN_ELEMENTS) return;

    this.trimId = requestIdle(this.trim, { timeout: TRIM_IDLE_TIMEOUT_MS });
  }

  /** Undraws the drawn chunks farthest from the screen, down to the limit. */
  private trim = (deadline: IdleDeadline) => {
    this.trimId = null;
    if (this.closed) return;

    this.undrawFarthest(
      performance.now() + Math.max(STEP_BUDGET_MS, deadline.timeRemaining()),
    );
    this.scheduleTrim();
  };

  /**
   * Undraws the drawn chunks farthest from the screen until the limit's
   * share is left or `until` passes, at least one. Returns how many.
   */
  private undrawFarthest(until: number) {
    let drawn = this.drawnElements();
    const goal = MAX_DRAWN_ELEMENTS * UNDRAW_DOWN_TO;
    if (drawn <= goal) return 0;

    const selection = this.editor?.selection;
    const held = selection
      ? [selection.anchor.path[0], selection.focus.path[0]]
      : [];

    const farthest = [...this.chunks]
      .filter(
        (chunk) =>
          !chunk.isUndrawn &&
          chunk.element &&
          !held.some((block) => chunk.first <= block && block <= chunk.last),
      )
      .map((chunk) => ({ chunk, distance: distanceFromScreen(chunk.element!) }))
      .filter(({ distance }) => distance > DRAW_AHEAD_PX)
      .sort((a, b) => b.distance - a.distance);

    let undrawn = 0;
    for (const { chunk } of farthest) {
      if (drawn <= goal) break;
      drawn -= chunk.elements;
      chunk.undraw();
      undrawn += 1;
      if (performance.now() >= until) break;
    }
    return undrawn;
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
          if (this.isLimited) this.sizeUndrawnLikeDrawn();
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
    if (this.trimId !== null) cancelIdle(this.trimId);
    this.trimId = null;
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

  /**
   * Gives the parts not drawn yet the space per block the drawn ones take,
   * so the scrollbar fits the shard, keeping what's on screen in place.
   */
  private sizeUndrawnLikeDrawn() {
    const drawn = [...this.chunks].filter(
      (chunk) => !chunk.isUndrawn && chunk.element,
    );
    let blocks = 0;
    let height = 0;
    for (const chunk of drawn) {
      blocks += chunk.last - chunk.first + 1;
      height += pinChunkHeight(chunk.element!);
    }
    if (blocks === 0) return;

    const anchor = drawn.find(
      (chunk) => chunk.element!.getBoundingClientRect().bottom > 0,
    )?.element;
    const topBefore = anchor?.getBoundingClientRect().top;
    this.blockHeight = Math.round(height / blocks);
    flushSync(() => this.listeners.forEach((listener) => listener()));

    if (!anchor || topBefore === undefined) return;
    const scrollRoot = findScrollableAncestor(anchor);
    if (scrollRoot) {
      scrollRoot.scrollTop += anchor.getBoundingClientRect().top - topBefore;
    }
  }

  private setDrawnBlocks(count: number) {
    this.drawnBlocks = count;
    this.listeners.forEach((listener) => listener());
  }
}

const drawers = new WeakMap<SlateEditor, ChunkDrawer>();

export function registerChunkDrawer(editor: SlateEditor, drawer: ChunkDrawer) {
  drawer.attach(editor);
  drawers.set(editor, drawer);
}

/** How far `element` is above or below the window, 0 when in it. */
function distanceFromScreen(element: HTMLElement) {
  const { top, bottom } = element.getBoundingClientRect();
  if (bottom < 0) return -bottom;
  if (top > window.innerHeight) return top - window.innerHeight;
  return 0;
}

/**
 * Draws again a part undrawn for the drawn-element limit when the
 * selection moves into it (an undo far down, Ctrl+End), before the editor
 * puts the caret on the page.
 */
export const KeepSelectionDrawnPlugin = createSlatePlugin({
  key: "keepSelectionDrawn",
}).overrideEditor(({ editor, api: { onChange } }) => ({
  api: {
    onChange(options) {
      drawers.get(editor)?.keepSelectionDrawn();
      onChange(options);
    },
  },
}));

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
  if (!drawer) return true;
  if (drawer.isDrawn(blockIndex) && !drawer.isUndrawnAgain(blockIndex)) {
    return true;
  }

  drawer.drawThrough(blockIndex);
  drawer.redrawAt(blockIndex);
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
  const isReached = drawer?.isClosed ? isDrawnNow : wasDrawnRef.current;
  // Undrawn for the drawn-element limit, at the height it had if it was
  // drawn before.
  const [isUndrawnAgain, setUndrawnAgain] = useState(
    () => !!drawer && !!range && drawer.startsUndrawn(range.first, range.last),
  );
  const keptHeightRef = useRef<number | null>(null);
  const isDrawn = isReached && !isUndrawnAgain;
  const blockHeight = useSyncExternalStore(
    drawer?.subscribe ?? noSubscription,
    () => drawer?.undrawnBlockHeight ?? UNDRAWN_BLOCK_HEIGHT_PX,
  );

  const placeholderRef = useRef<HTMLDivElement>(null);
  const chunkRef = useRef<HTMLDivElement>(null);
  const first = range?.first;
  const last = range?.last;

  // Drawn now, with its height pinned. A part starting above the window
  // moves what's on screen by however much taller or shorter it is than its
  // placeholder, so the window scrolls by as much.
  const redraw = () => {
    const before = placeholderRef.current?.getBoundingClientRect();
    flushSync(() => setUndrawnAgain(false));
    const chunk = chunkRef.current;
    if (!chunk || !before) return;

    const height = pinChunkHeight(chunk);
    keptHeightRef.current = height;
    if (before.top < 0) {
      const scrollRoot = findScrollableAncestor(chunk);
      if (scrollRoot) scrollRoot.scrollTop += height - before.height;
    }
  };

  useEffect(() => {
    if (!drawer || drawer.isClosed || !isReached) return;
    if (first === undefined || last === undefined) return;

    return drawer.track({
      first,
      last,
      elements: drawer.countElements(first, last),
      isUndrawn: isUndrawnAgain,
      get element() {
        return chunkRef.current;
      },
      undraw: () => {
        if (chunkRef.current) {
          keptHeightRef.current = pinChunkHeight(chunkRef.current);
        }
        flushSync(() => setUndrawnAgain(true));
      },
      redraw,
    });
  }, [drawer, first, isReached, isUndrawnAgain, last]);

  useEffect(() => {
    const placeholder = placeholderRef.current;
    if (isDrawn || !drawer || drawer.isClosed) return;
    if (last === undefined || !placeholder) return;

    let idleId: number | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!isUndrawnAgain) {
          drawer.drawThrough(last);
          return;
        }
        // Drawn again only if it's still near the screen at the next quiet
        // moment: a jump or a fast scroll passes many parts it shouldn't draw.
        if (idleId !== null) return;
        idleId = requestIdle(
          () => {
            idleId = null;
            if (distanceFromScreen(placeholder) <= DRAW_AHEAD_PX) redraw();
          },
          { timeout: DRAW_IDLE_TIMEOUT_MS },
        );
      },
      { rootMargin: DRAW_AHEAD_MARGIN },
    );
    observer.observe(placeholder);
    return () => {
      observer.disconnect();
      if (idleId !== null) cancelIdle(idleId);
    };
  }, [drawer, isDrawn, isUndrawnAgain, last]);

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
          height:
            keptHeightRef.current ??
            (range.last - range.first + 1) * blockHeight,
        }}
      />
    );
  }

  // Off screen, a chunk keeps the space its placeholder had until it's
  // measured, so the scrollbar doesn't jump as later parts are drawn.
  const estimate = range
    ? `auto ${keptHeightRef.current ?? (range.last - range.first + 1) * blockHeight}px`
    : undefined;

  return (
    <div
      key="drawn"
      ref={chunkRef}
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
