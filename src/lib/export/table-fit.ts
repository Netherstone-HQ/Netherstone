/**
 * Column widths for a table on paper, which can't scroll sideways. Each
 * column gets at least the width of its longest word, so no word breaks;
 * the rest of the width follows the widths the writer chose. A table whose
 * longest words don't fit side by side is scaled down until they do.
 */

export interface FittedColumns {
  widths: number[];
  /** 1, or how much the table's text has to shrink to fit. */
  scale: number;
}

/**
 * Fits columns into `width`. `preferred` are the writer's widths in any
 * unit (only their proportions count); `minimums` are what each column's
 * content needs, in the unit of `width`.
 */
export function fitColumns(preferred: number[], minimums: number[], width: number): FittedColumns {
  const needed = sum(minimums);
  if (needed > width) {
    const scale = width / needed;
    return { widths: wholeWidths(minimums.map((minimum) => minimum * scale), width), scale };
  }

  // Columns the preferred share would make too narrow are held at their
  // minimum; the others share what's left in their preferred proportions.
  // Holding a column can push another under its minimum, so it repeats
  // until no new column is held.
  const held = new Set<number>();
  let widths: number[] = [];
  for (;;) {
    const free = width - sum([...held].map((index) => minimums[index]));
    const share = sum(preferred.filter((_, index) => !held.has(index)));
    widths = preferred.map((value, index) => (held.has(index) ? minimums[index] : (value / share) * free));
    const under = widths.flatMap((value, index) => (!held.has(index) && value < minimums[index] ? [index] : []));
    if (!under.length) break;
    for (const index of under) held.add(index);
  }
  return { widths: wholeWidths(widths, width), scale: 1 };
}

/**
 * The widths in whole units, adding up to `total` exactly. Each column's
 * width is rounded at its edge, so rounding never adds up along the row.
 */
function wholeWidths(widths: number[], total: number): number[] {
  const scale = total / sum(widths);
  let edge = 0;
  let placed = 0;
  return widths.map((value) => {
    edge += value * scale;
    const next = Math.round(edge);
    const whole = next - placed;
    placed = next;
    return whole;
  });
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
