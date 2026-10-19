import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  calendarLevel,
  dayKey,
  latestDay,
  monthTotals,
  totalsByDay,
  type WritingEntry,
} from "./data";

function entry(day: string, name: string, words: number): WritingEntry {
  return { day, name, path: `/v/${name}`, words, exists: true };
}

describe("writing totals", () => {
  const days = totalsByDay([
    entry("2026-09-30", "Old.md", 50),
    entry("2026-10-14", "Short.md", 38),
    entry("2026-10-14", "Long.md", 412),
    entry("2026-10-18", "Edit.md", 0),
  ]);

  it("adds up each day, most words first", () => {
    const day = days.get("2026-10-14");
    expect(day?.words).toBe(450);
    expect(day?.shards.map((s) => s.name)).toEqual(["Long.md", "Short.md"]);
  });

  it("counts this month's words and days", () => {
    expect(monthTotals(days, new Date(2026, 9, 19))).toEqual({
      words: 450,
      daysWritten: 2,
      daysSoFar: 19,
    });
  });

  it("opens on the last day written", () => {
    expect(latestDay(days, new Date(2026, 9, 19))).toBe("2026-10-18");
    expect(latestDay(new Map(), new Date(2026, 9, 19))).toBe("2026-10-19");
  });
});

describe("calendar", () => {
  it("shades by share of the busiest day, and shows edits without words", () => {
    expect(calendarLevel(undefined, 100)).toBe(0);
    expect(calendarLevel(0, 100)).toBe(1);
    expect(calendarLevel(20, 100)).toBe(1);
    expect(calendarLevel(50, 100)).toBe(2);
    expect(calendarLevel(70, 100)).toBe(3);
    expect(calendarLevel(100, 100)).toBe(4);
  });

  it("ends with this week, Monday first", () => {
    const today = new Date(2026, 9, 19); // A Monday.
    const weeks = buildCalendar({
      days: totalsByDay([entry("2026-10-14", "A.md", 10)]),
      today,
      startedOn: "2026-10-01",
      weekCount: 27,
      locale: "en-GB",
    });

    expect(weeks).toHaveLength(27);
    const last = weeks[26].days;
    expect(dayKey(last[0].date)).toBe("2026-10-19");
    expect(last[1].isFuture).toBe(true);
    expect(weeks[25].days[2]).toMatchObject({ day: "2026-10-14", level: 4 });
    expect(weeks[0].days[0].isBeforeStart).toBe(true);
    expect(weeks.filter((w) => w.label).map((w) => w.label)).toContain("Oct");
  });
});
