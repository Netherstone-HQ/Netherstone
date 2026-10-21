import { forwardRef, useState } from "react";

import { niceTicks, type ChartData, type ChartKind } from "@/lib/chart";
import { cn } from "@/lib/utils";

/**
 * The series' colours, in a fixed order: the theme's chart colour, then a
 * shade apart in lightness so the two read apart without colour, then grey.
 */
export const SERIES_CLASSES = [
  "fill-chart-3 stroke-chart-3 bg-chart-3",
  "fill-chart-5 stroke-chart-5 bg-chart-5 dark:fill-chart-1 dark:stroke-chart-1 dark:bg-chart-1",
  "fill-muted-foreground stroke-muted-foreground bg-muted-foreground",
];

const WIDTH = 640;
const HEIGHT = 240;
const PLOT = { top: 10, right: 8, bottom: 26, left: 44 };
/** A small chart has no room for its numbers or labels. */
const COMPACT_PLOT = { top: 6, right: 4, bottom: 2, left: 4 };
/** Labels along the bottom at most; the others are skipped. */
const MAX_LABELS = 10;

function formatValue(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function shortLabel(label: string) {
  return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}

/**
 * A bar from the baseline at `base` to `end`, with 4px rounded corners at
 * the end away from the baseline, which stays square.
 */
function barPath(x: number, width: number, base: number, end: number) {
  const r = Math.min(4, width / 2, Math.abs(base - end));
  const dir = end < base ? 1 : -1;
  const right = x + width;
  return [
    `M${x},${base}`,
    `V${end + dir * r}`,
    `Q${x},${end} ${x + r},${end}`,
    `H${right - r}`,
    `Q${right},${end} ${right},${end + dir * r}`,
    `V${base}Z`,
  ].join("");
}

/**
 * A bar or line chart drawn in SVG from the theme's colours. Hovering a
 * column shows its values, except on a compact chart, drawn small without
 * its numbers and labels.
 */
export const ChartSvg = forwardRef<
  SVGSVGElement,
  { kind: ChartKind; data: ChartData; label: string; isCompact?: boolean }
>(function ChartSvg({ kind, data, label, isCompact = false }, ref) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { labels, series } = data;

  const values = series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null),
  );
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const low = ticks[0];
  const high = ticks[ticks.length - 1];
  const plot = isCompact ? COMPACT_PLOT : PLOT;

  const plotWidth = WIDTH - plot.left - plot.right;
  const plotHeight = HEIGHT - plot.top - plot.bottom;
  const y = (value: number) =>
    plot.top + plotHeight - ((value - low) / (high - low)) * plotHeight;
  const band = plotWidth / Math.max(1, labels.length);
  const bandX = (index: number) => plot.left + band * index;
  const labelEvery = Math.ceil(labels.length / MAX_LABELS);

  const groupWidth = Math.min(band * 0.7, 44 * series.length);
  const barWidth = Math.max(
    1,
    (groupWidth - 2 * (series.length - 1)) / Math.max(1, series.length),
  );

  return (
    <div className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full overflow-visible font-sans"
        role="img"
        aria-label={label}
        onMouseLeave={() => setHovered(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={plot.left}
              x2={WIDTH - plot.right}
              y1={y(tick)}
              y2={y(tick)}
              className={tick === 0 ? "stroke-border" : "stroke-border/50"}
              strokeWidth={1}
            />
            {isCompact ? null : (
              <text
                x={plot.left - 8}
                y={y(tick)}
                dy="0.35em"
                textAnchor="end"
                className="fill-muted-foreground text-[12px]"
              >
                {formatValue(tick)}
              </text>
            )}
          </g>
        ))}

        {labels.map((name, index) =>
          !isCompact && index % labelEvery === 0 ? (
            <text
              key={index}
              x={bandX(index) + band / 2}
              y={HEIGHT - 8}
              textAnchor="middle"
              className="fill-muted-foreground text-[12px]"
            >
              {shortLabel(name)}
            </text>
          ) : null,
        )}

        {kind === "bar"
          ? series.map((s, si) => (
              <g key={s.name} data-series={si} className={SERIES_CLASSES[si]}>
                {s.values.map((value, index) => {
                  if (value === null) return null;
                  const x =
                    bandX(index) +
                    (band - groupWidth) / 2 +
                    si * (barWidth + 2);
                  return (
                    <path
                      key={index}
                      d={barPath(x, barWidth, y(0), y(value))}
                      stroke="none"
                      opacity={hovered === null || hovered === index ? 1 : 0.55}
                    />
                  );
                })}
              </g>
            ))
          : series.map((s, si) => {
              const points = s.values
                .map((value, index) =>
                  value === null
                    ? null
                    : `${bandX(index) + band / 2},${y(value)}`,
                )
                .filter(Boolean);
              return (
                <g key={s.name} data-series={si} className={SERIES_CLASSES[si]}>
                  <polyline
                    points={points.join(" ")}
                    fill="none"
                    strokeWidth={isCompact ? 3 : 2}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {hovered !== null && s.values[hovered] !== null ? (
                    <circle
                      cx={bandX(hovered) + band / 2}
                      cy={y(s.values[hovered] as number)}
                      r={4}
                      strokeWidth={2}
                      className="stroke-card"
                    />
                  ) : null}
                </g>
              );
            })}

        {kind === "line" && hovered !== null ? (
          <line
            x1={bandX(hovered) + band / 2}
            x2={bandX(hovered) + band / 2}
            y1={plot.top}
            y2={plot.top + plotHeight}
            className="stroke-muted-foreground/50"
            strokeWidth={1}
          />
        ) : null}

        {/* Hit targets: a whole column each, larger than any bar. */}
        {isCompact
          ? null
          : labels.map((_, index) => (
              <rect
                key={index}
                x={bandX(index)}
                y={plot.top}
                width={band}
                height={plotHeight}
                fill="transparent"
                onMouseEnter={() => setHovered(index)}
              />
            ))}
      </svg>

      {hovered !== null ? (
        <div
          className={cn(
            "pointer-events-none absolute top-0 z-10 min-w-28 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground text-ui-sm shadow-md",
          )}
          style={{
            left: `${((bandX(hovered) + band / 2) / WIDTH) * 100}%`,
          }}
        >
          <div className="mb-0.5 font-medium">{labels[hovered]}</div>
          {series.map((s, si) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  SERIES_CLASSES[si],
                )}
              />
              <span className="text-muted-foreground">{s.name}</span>
              <span className="ml-auto pl-3 tabular-nums">
                {s.values[hovered] === null
                  ? "–"
                  : formatValue(s.values[hovered] as number)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
});
