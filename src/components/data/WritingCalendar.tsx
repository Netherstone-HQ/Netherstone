import { useLayoutEffect, useRef, type CSSProperties } from "react";

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

const CELL = "size-3 shrink-0 rounded-[2px]";
const WEEKDAYS = ["Mon", "", "Wed", "", "Fri", "", ""];

/** The shades from no writing to the most, for the key under the calendar. */
export function CalendarKey() {
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      Less
      {([0, 1, 2, 3, 4] as const).map((level) => (
        <span
          key={level}
          className={cn(CELL, "bg-muted")}
          style={levelStyle(level)}
        />
      ))}
      More
    </span>
  );
}

/**
 * The weeks as columns of days, Monday at the top, newest on the right. Days
 * you wrote on are shaded by how much; picking one shows its shards.
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const longDate = new Intl.DateTimeFormat(locale, { dateStyle: "long" });

  // The newest weeks are on the right; start there when they don't all fit.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, [weeks.length]);

  return (
    <div className="flex gap-2">
      <div
        aria-hidden="true"
        className="flex shrink-0 flex-col gap-0.75 pt-4.5 text-[11px] text-muted-foreground leading-3"
      >
        {WEEKDAYS.map((label, i) => (
          <span key={i} className="h-3">
            {label}
          </span>
        ))}
      </div>
      {/* Padded so the picked day's ring isn't clipped at the edges. */}
      <div ref={scrollRef} className="-m-1 min-w-0 overflow-x-auto p-1">
        <div className="flex w-max flex-col gap-1.5">
          <div aria-hidden="true" className="flex h-3 gap-0.75">
            {weeks.map((week, i) => (
              <span
                key={i}
                className="w-3 shrink-0 overflow-visible whitespace-nowrap text-[11px] text-muted-foreground leading-3"
              >
                {week.label}
              </span>
            ))}
          </div>
          <div className="flex gap-0.75" role={isInert ? undefined : "group"} aria-label={isInert ? undefined : "Days written"}>
            {weeks.map((week, i) => (
              <div key={i} className="flex flex-col gap-0.75">
                {week.days.map((day) => {
                  if (day.isFuture) {
                    return <span key={day.day} className={CELL} />;
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
                  return isInert ? (
                    <span
                      key={day.day}
                      className={className}
                      style={levelStyle(day.level)}
                    />
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
                      style={levelStyle(day.level)}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
