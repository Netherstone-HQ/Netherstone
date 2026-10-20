/** One step from sequence `a` to sequence `b`. */
export type Edit =
  | { kind: "equal"; a: number; b: number }
  | { kind: "removed"; a: number }
  | { kind: "added"; b: number };

/**
 * The shortest edit from `a` to `b` (Myers), with the items removed before
 * the items added in each changed run. Past `maxEdits` changes it stops
 * looking and reports the differing middle as removed, then added.
 */
export function diffSequences(
  a: string[],
  b: string[],
  maxEdits = 1000,
): Edit[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start])
    start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const edits: Edit[] = [];
  for (let i = 0; i < start; i += 1) edits.push({ kind: "equal", a: i, b: i });

  const middle = shortestEdit(a, start, endA, b, start, endB, maxEdits);
  if (middle) {
    edits.push(...middle);
  } else {
    for (let i = start; i < endA; i += 1) edits.push({ kind: "removed", a: i });
    for (let i = start; i < endB; i += 1) edits.push({ kind: "added", b: i });
  }

  for (let i = 0; endA + i < a.length; i += 1) {
    edits.push({ kind: "equal", a: endA + i, b: endB + i });
  }
  return removedFirst(edits);
}

function shortestEdit(
  a: string[],
  aStart: number,
  aEnd: number,
  b: string[],
  bStart: number,
  bEnd: number,
  maxEdits: number,
): Edit[] | null {
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  if (n === 0 && m === 0) return [];
  const max = Math.min(n + m, maxEdits);
  const offset = max + 1;
  // v[offset + k]: the furthest x reached on diagonal k.
  const v = new Int32Array(2 * max + 3);
  // Before each step d, the diagonals -d-1..d+1 of `v`.
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[aStart + x] === b[bStart + y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, d, n, m, aStart, bStart);
      }
    }
  }
  return null;
}

function backtrack(
  trace: Int32Array[],
  steps: number,
  n: number,
  m: number,
  aStart: number,
  bStart: number,
): Edit[] {
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = steps; d > 0; d -= 1) {
    const before = trace[d];
    const at = (k: number) => before[k + d + 1];
    const k = x - y;
    const previousK =
      k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      edits.push({ kind: "equal", a: aStart + x, b: bStart + y });
    }
    if (previousK === k + 1)
      edits.push({ kind: "added", b: bStart + previousY });
    else edits.push({ kind: "removed", a: aStart + previousX });
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    edits.push({ kind: "equal", a: aStart + x, b: bStart + y });
  }
  return edits.reverse();
}

function removedFirst(edits: Edit[]): Edit[] {
  const ordered: Edit[] = [];
  let run: Edit[] = [];
  const flush = () => {
    ordered.push(...run.filter((edit) => edit.kind === "removed"));
    ordered.push(...run.filter((edit) => edit.kind === "added"));
    run = [];
  };
  for (const edit of edits) {
    if (edit.kind === "equal") {
      flush();
      ordered.push(edit);
    } else {
      run.push(edit);
    }
  }
  flush();
  return ordered;
}
