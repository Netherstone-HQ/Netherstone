import {
  OperationApi,
  type Descendant,
  type Operation,
  type Range,
  type SlateEditor,
} from "platejs";

/**
 * A run of top-level blocks that differs between two values: `start`–`end`
 * in the first, `nextStart`–`nextEnd` in the second. An empty run in the
 * first is an insert.
 */
export type BlockHunk = {
  start: number;
  end: number;
  nextStart: number;
  nextEnd: number;
};

/** Blocks `start`–`end` of a value replaced with `count` others. */
export type BlockReplacement = { start: number; end: number; count: number };

/** Edits past this many blocks are compared as one run. */
const MAX_DIFF_EDITS = 1000;

/** Deep equality for Plate nodes, ignoring generated block ids. */
export function isSameNode(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => isSameNode(item, b[index]));
  }
  if (Array.isArray(b)) return false;

  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord).filter((key) => key !== "id");
  const bKeys = Object.keys(bRecord).filter((key) => key !== "id");
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => key in bRecord && isSameNode(aRecord[key], bRecord[key]),
  );
}

/**
 * The runs of top-level blocks that differ between two values, in order.
 * Blocks compare by content, ignoring ids, or with `byIdentity` as the same
 * objects (Slate keeps unchanged blocks, so edited ones are new objects).
 */
export function diffBlocks(
  current: readonly unknown[],
  next: readonly unknown[],
  { byIdentity = false }: { byIdentity?: boolean } = {},
): BlockHunk[] {
  const same = byIdentity ? Object.is : isSameNode;

  let start = 0;
  const shortest = Math.min(current.length, next.length);
  while (start < shortest && same(current[start], next[start])) start += 1;

  let end = current.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && same(current[end - 1], next[nextEnd - 1])) {
    end -= 1;
    nextEnd -= 1;
  }
  if (start === end && start === nextEnd) return [];

  // Equal blocks get equal numbers, so the diff compares numbers.
  const ids = new Map<unknown, number>();
  const idOf = (node: unknown) => {
    const key = byIdentity ? node : contentKey(node);
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
    }
    return id;
  };
  const a = current.slice(start, end).map(idOf);
  const b = next.slice(start, nextEnd).map(idOf);

  return diffIds(a, b).map((hunk) => ({
    start: hunk.start + start,
    end: hunk.end + start,
    nextStart: hunk.nextStart + start,
    nextEnd: hunk.nextEnd + start,
  }));
}

/** A node as text with its keys sorted and ids left out. */
function contentKey(node: unknown): string {
  return JSON.stringify(node, (key, value) => {
    if (key === "id") return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const sorted: Record<string, unknown> = {};
    for (const name of Object.keys(value).sort()) sorted[name] = value[name];
    return sorted;
  });
}

/** Myers' diff of two lists of numbers, as runs that differ. */
function diffIds(a: number[], b: number[]): BlockHunk[] {
  const n = a.length;
  const m = b.length;
  const whole = [{ start: 0, end: n, nextStart: 0, nextEnd: m }];
  if (n === 0 || m === 0) return whole;

  const limit = Math.min(n + m, MAX_DIFF_EDITS);
  // v[k + offset]: how far along `a` the path on diagonal k has got.
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d += 1) {
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return hunksFromTrace(trace, a, b);
    }
  }
  return whole;
}

function hunksFromTrace(trace: Int32Array[], a: number[], b: number[]) {
  // trace[d] holds the paths after d - 1 edits, diagonals -d to d.
  const hunks: BlockHunk[] = [];
  let x = a.length;
  let y = b.length;
  let runEnd = x;
  let runNextEnd = y;

  const closeRun = () => {
    if (x !== runEnd || y !== runNextEnd) {
      hunks.push({ start: x, end: runEnd, nextStart: y, nextEnd: runNextEnd });
    }
  };

  for (let d = trace.length - 1; d > 0; d -= 1) {
    const v = trace[d];
    const at = (k: number) => v[k + d];
    const k = x - y;
    const prevK =
      k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    if (x > prevX && y > prevY) {
      closeRun();
      while (x > prevX && y > prevY) {
        x -= 1;
        y -= 1;
      }
      runEnd = x;
      runNextEnd = y;
    }
    x = prevX;
    y = prevY;
  }
  closeRun();
  return hunks.reverse();
}

/**
 * Brings `theirs` (changes to a base) in around `ours` (other changes to the
 * same base). Returns where each of their changes goes among our blocks, or
 * null when both changed the same blocks, or added blocks at the same place.
 * A change both made alike is left out.
 */
export function mergeHunks(
  ours: readonly BlockHunk[],
  theirs: readonly BlockHunk[],
  isSameChange: (mine: BlockHunk, theirs: BlockHunk) => boolean,
): { hunk: BlockHunk; start: number }[] | null {
  const placed: { hunk: BlockHunk; start: number }[] = [];
  for (const hunk of theirs) {
    let shift = 0;
    let alike = false;
    for (const mine of ours) {
      if (overlaps(mine, hunk)) {
        if (mine.start === hunk.start && mine.end === hunk.end && isSameChange(mine, hunk)) {
          alike = true;
          continue;
        }
        return null;
      }
      if (mine.end <= hunk.start) {
        shift += mine.nextEnd - mine.nextStart - (mine.end - mine.start);
      }
    }
    if (!alike) placed.push({ hunk, start: hunk.start + shift });
  }
  return placed;
}

function overlaps(a: BlockHunk, b: BlockHunk) {
  if (a.start === a.end && b.start === b.end) return a.start === b.start;
  return a.start < b.end && b.start < a.end;
}

/**
 * Keeps the editor's undo and redo steps working after `replaced` (sorted,
 * in the blocks as they are now) changed without being saved to history.
 * Steps are moved past the changed blocks. A step that touches them can't
 * apply any more, so it goes, with every step before it.
 */
export function rebaseHistory(
  editor: SlateEditor,
  replaced: readonly BlockReplacement[],
) {
  const { history } = editor;
  history.undos = rebaseUndos(history.undos, replaced);
  history.redos = rebaseRedos(history.redos, replaced);
}

type Batch = SlateEditor["history"]["undos"][number] & {
  selectionAfter?: Range | null;
};

function rebaseUndos(undos: Batch[], replaced: readonly BlockReplacement[]) {
  const kept: Batch[] = [];
  let frame = replaced;
  // Undo applies the newest step's inverse first, to the blocks as they are.
  for (let index = undos.length - 1; index >= 0; index -= 1) {
    const batch = undos[index];
    const operations: Operation[] = [];
    for (let at = batch.operations.length - 1; at >= 0; at -= 1) {
      const moved = rebaseOperation(OperationApi.inverse(batch.operations[at]), frame);
      if (!moved) return kept;
      operations.unshift(OperationApi.inverse(moved.operation));
      frame = moved.replaced;
    }
    kept.unshift({
      ...batch,
      operations,
      selectionBefore: mapRange(batch.selectionBefore, frame),
    });
  }
  return kept;
}

function rebaseRedos(redos: Batch[], replaced: readonly BlockReplacement[]) {
  const kept: Batch[] = [];
  let frame = replaced;
  for (let index = redos.length - 1; index >= 0; index -= 1) {
    const batch = redos[index];
    const selectionBefore = mapRange(batch.selectionBefore, frame);
    const operations: Operation[] = [];
    for (const operation of batch.operations) {
      const moved = rebaseOperation(operation, frame);
      if (!moved) return kept;
      operations.push(moved.operation);
      frame = moved.replaced;
    }
    kept.unshift({
      ...batch,
      operations,
      selectionBefore,
      ...(batch.selectionAfter !== undefined && {
        selectionAfter: mapRange(batch.selectionAfter, frame),
      }),
    });
  }
  return kept;
}

/**
 * `operation`, made for the blocks before `replaced`, made for the blocks
 * after it; and `replaced` as it is in the blocks after `operation`. Null
 * when the operation touches a replaced block.
 */
function rebaseOperation(
  operation: Operation,
  replaced: readonly BlockReplacement[],
): { operation: Operation; replaced: readonly BlockReplacement[] } | null {
  if (operation.type === "set_selection") return { operation, replaced };

  const { path } = operation;
  if (operation.type === "move_node") {
    // Moving top-level blocks is rare; let go of history instead.
    if (path.length < 2 || operation.newPath.length < 2) return null;
    const from = mapBlock(replaced, path[0]);
    const to = mapBlock(replaced, operation.newPath[0]);
    if (from === null || to === null) return null;
    return {
      operation: {
        ...operation,
        path: [from, ...path.slice(1)],
        newPath: [to, ...operation.newPath.slice(1)],
      },
      replaced,
    };
  }

  const index = path[0];
  if (path.length > 1 || operation.type === "set_node") {
    const block = mapBlock(replaced, index);
    if (block === null) return null;
    return { operation: { ...operation, path: [block, ...path.slice(1)] }, replaced };
  }

  const shift = (after: (r: BlockReplacement) => boolean, by: number) =>
    replaced.map((r) =>
      after(r) ? { start: r.start + by, end: r.end + by, count: r.count } : r,
    );

  switch (operation.type) {
    case "insert_node": {
      const at = mapPosition(replaced, index);
      if (at === null) return null;
      return {
        operation: { ...operation, path: [at] },
        // A block added where theirs were stays after them.
        replaced: shift((r) => r.start > index || (r.start === index && r.end > r.start), 1),
      };
    }
    case "remove_node":
    case "split_node": {
      const block = mapBlock(replaced, index);
      if (block === null) return null;
      return {
        operation: { ...operation, path: [block] },
        replaced: shift((r) => r.start > index, operation.type === "split_node" ? 1 : -1),
      };
    }
    case "merge_node": {
      const block = mapBlock(replaced, index);
      const previous = mapBlock(replaced, index - 1);
      if (block === null || previous === null || block !== previous + 1) return null;
      return {
        operation: { ...operation, path: [block] },
        replaced: shift((r) => r.start > index, -1),
      };
    }
    default:
      return null;
  }
}

/** Where block `index` is after `replaced`, or null if it was replaced. */
function mapBlock(replaced: readonly BlockReplacement[], index: number) {
  let shift = 0;
  for (const r of replaced) {
    if (r.end <= index) shift += r.count - (r.end - r.start);
    else if (r.start <= index) return null;
    else break;
  }
  return index + shift;
}

/**
 * Where the place before block `index` is after `replaced`, or null if it
 * was inside replaced blocks. Blocks added there go after theirs.
 */
function mapPosition(replaced: readonly BlockReplacement[], index: number) {
  let shift = 0;
  for (const r of replaced) {
    if (r.end <= index) shift += r.count - (r.end - r.start);
    else if (r.start < index) return null;
    else break;
  }
  return index + shift;
}

function mapRange(
  range: Range | null | undefined,
  replaced: readonly BlockReplacement[],
): Range | null {
  if (!range) return null;
  const anchor = mapBlock(replaced, range.anchor.path[0]);
  const focus = mapBlock(replaced, range.focus.path[0]);
  if (anchor === null || focus === null) return null;
  return {
    anchor: { ...range.anchor, path: [anchor, ...range.anchor.path.slice(1)] },
    focus: { ...range.focus, path: [focus, ...range.focus.path.slice(1)] },
  };
}

/** The blocks of `value` in `hunk`'s second run. */
export function nextBlocks(value: readonly Descendant[], hunk: BlockHunk) {
  return value.slice(hunk.nextStart, hunk.nextEnd);
}
