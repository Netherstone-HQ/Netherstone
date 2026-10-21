import { Fragment, type CSSProperties } from "react";

import { cn } from "@/lib/utils";
import type { CalendarLevel, CalendarWeek } from "@/lib/data";

/** How much of the theme's chart colour each level mixes into an empty day. */
const LEVEL_SHARE: Record<Exclude<CalendarLevel, 0>, number> = {
  1: 30,
  2: 55,
  3: 80,
  4: 100,
};

function levelStyle(level: CalendarLevel): CSSProperties | undefined {
  if (level === 0) return undefined;
  return {
    backgroundColor: `color-mix(in oklab, var(--chart-3) ${LEVEL_SHARE[level]}%, var(--muted))`,
  };
}

const CELL = "aspect-square w-full rounded-[2px]";
const KEY_CELL = "size-2.5 rounded-[2px]";
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

/** The shades from no writing to the most, for the key under the calendar. */
export function CalendarKey() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      Less
      {([0, 1, 2, 3, 4] as const).map((level) => (
        <span
          key={level}
          className={cn(KEY_CELL, "bg-muted")}
          style={levelStyle(level)}
        />
      ))}
      More
    </span>
  );
}

/**
 * The weeks as columns of days, Monday at the top, newest on the right,
 * stretched to the card's width. Days you wrote on are shaded by how much;
 * picking one shows its shards.
 */
export function WritingCalendar({
  weeks,
  pickedDay,
  onPick,
  isInert = false,
  locale,
}: {
  weeks: CalendarWeek[];
  pickedDay?: string;
  onPick?: (day: string) => void;
  /** Drawn only, for a vault with no writing yet. */
  isInert?: boolean;
  locale?: string;
}) {
  const longDate = new Intl.DateTimeFormat(locale, { dateStyle: "long" });

  return (
    <div
      role={isInert ? undefined : "group"}
      aria-label={isInert ? undefined : "Days written"}
      className="grid gap-0.5"
      style={{
        gridTemplateColumns: `auto repeat(${weeks.length}, minmax(0, 1fr))`,
      }}
    >
      {WEEKDAYS.map((label, i) => (
        // Out of the flow, so the labels don't make their rows taller than
        // the days once those shrink.
        <span
          key={i}
          aria-hidden="true"
          className="relative w-8"
          style={{ gridColumn: 1, gridRow: i + 2 }}
        >
          <span className="absolute top-1/2 left-0 -translate-y-1/2 text-[11px] text-muted-foreground leading-3">
            {label}
          </span>
        </span>
      ))}
      {weeks.map((week, w) => (
        <Fragment key={w}>
          <span
            aria-hidden="true"
            className="overflow-visible whitespace-nowrap pb-1 text-[11px] text-muted-foreground leading-3"
            style={{ gridColumn: w + 2, gridRow: 1 }}
          >
            {week.label}
          </span>
          {week.days.map((day, d) => {
            const place = { gridColumn: w + 2, gridRow: d + 2 };
            if (day.isFuture) {
              return <span key={day.day} className={CELL} style={place} />;
            }
            const label = `${longDate.format(day.date)}: ${
              day.level === 0
                ? "nothing written"
                : `${day.words.toLocaleString(locale)} ${day.words === 1 ? "word" : "words"}`
            }`;
            const className = cn(
              CELL,
              "bg-muted",
              day.isBeforeStart && "opacity-40",
              day.day === pickedDay &&
                "ring-2 ring-foreground ring-offset-1 ring-offset-card",
            );
            const style = { ...place, ...levelStyle(day.level) };
            return isInert ? (
              <span key={day.day} className={className} style={style} />
            ) : (
              <button
                key={day.day}
                type="button"
                title={label}
                aria-label={label}
                aria-pressed={day.day === pickedDay}
                onClick={() => onPick?.(day.day)}
                className={cn(
                  className,
                  "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card",
                )}
                style={style}
              />
            );
          })}
        </Fragment>
      ))}
    </div>
  );
}
