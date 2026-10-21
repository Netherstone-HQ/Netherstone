import { invoke } from "@tauri-apps/api/core";
import { getAssetLabel } from "@/components/settings/attachment-format";
import type { MissingAttachment } from "@/lib/commands";

/** A shard's writing on one day, from the vault's history or this device's log. */
export interface WritingEntry {
  /** The local date, as `YYYY-MM-DD`. */
  day: string;
  path: string;
  name: string;
  /** Words added that day, never below zero. */
  words: number;
  /** False once the shard is deleted; its words still count. */
  exists: boolean;
  /** For a deleted shard: whether the local history still has it. */
  has_history: boolean;
}

export interface WritingLog {
  shard_count: number;
  word_count: number;
  /** The first day with writing counted, as `YYYY-MM-DD`. */
  started_on: string;
  /** Oldest first, over the last year or so. */
  entries: WritingEntry[];
}

/** An @ link to a shard that doesn't exist. */
export interface BrokenLink {
  text: string;
  /** The shard holding the link. */
  path: string;
  name: string;
}

/** A shard holding at least one chart. */
export interface ChartShard {
  path: string;
  name: string;
  charts: number;
}

export function getChartShards() {
  return invoke<ChartShard[]>("get_chart_shards");
}

export function getWritingLog(vaultPath: string) {
  return invoke<WritingLog>("get_writing_log", { vaultPath });
}

export function getBrokenLinks() {
  return invoke<BrokenLink[]>("get_broken_links");
}

/** One row per shard embedding each missing file. */
export function missingFileRows(missing: MissingAttachment[]) {
  return missing.flatMap((file) =>
    file.shardPaths.map((shardPath) => ({
      file,
      name: file.originalName ?? getAssetLabel(file.assetPath),
      shardPath,
    })),
  );
}

// ── Days ─────────────────────────────────────────────────────────────────────

/** `date`'s local day, as `YYYY-MM-DD`. */
export function dayKey(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight at the start of `day`, a `YYYY-MM-DD` key, in local time. */
export function parseDay(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

// ── Totals ───────────────────────────────────────────────────────────────────

export interface DayTotal {
  words: number;
  /** The shards written in that day, most words first. */
  shards: WritingEntry[];
}

/** Each day's words and shards, by `YYYY-MM-DD`. */
export function totalsByDay(entries: WritingEntry[]) {
  const days = new Map<string, DayTotal>();
  for (const entry of entries) {
    const total = days.get(entry.day) ?? { words: 0, shards: [] };
    total.words += entry.words;
    total.shards.push(entry);
    days.set(entry.day, total);
  }
  for (const total of days.values()) {
    total.shards.sort((a, b) => b.words - a.words || a.name.localeCompare(b.name));
  }
  return days;
}

/** Words written and days written in `today`'s month. */
export function monthTotals(days: Map<string, DayTotal>, today: Date) {
  const month = dayKey(today).slice(0, 7);
  let words = 0;
  let daysWritten = 0;
  for (const [day, total] of days) {
    if (!day.startsWith(month)) continue;
    words += total.words;
    daysWritten += 1;
  }
  return { words, daysWritten, daysSoFar: today.getDate() };
}

// ── Calendar ─────────────────────────────────────────────────────────────────

/** 0 is a day with no writing; 1 to 4 shade it, more words darker. */
export type CalendarLevel = 0 | 1 | 2 | 3 | 4;

export interface CalendarDay {
  day: string;
  date: Date;
  level: CalendarLevel;
  words: number;
  /** After today: drawn empty. */
  isFuture: boolean;
  /** Before this device started counting: drawn faded. */
  isBeforeStart: boolean;
}

export interface CalendarWeek {
  /** The month's short name on the first week that starts in it. */
  label: string;
  /** Monday first. */
  days: CalendarDay[];
}

/**
 * How dark a day is, against the busiest day shown. A day you edited without
 * adding words still shows, at the lightest shade.
 */
export function calendarLevel(words: number | undefined, most: number): CalendarLevel {
  if (words === undefined) return 0;
  if (words <= 0 || most <= 0) return 1;
  const share = words / most;
  return share <= 0.25 ? 1 : share <= 0.5 ? 2 : share <= 0.75 ? 3 : 4;
}

/** `weekCount` weeks ending with this one, Monday to Sunday. */
export function buildCalendar({
  days,
  today,
  startedOn,
  weekCount,
  locale,
}: {
  days: Map<string, DayTotal>;
  today: Date;
  startedOn: string;
  weekCount: number;
  locale?: string;
}): CalendarWeek[] {
  const monday = addDays(today, -((today.getDay() + 6) % 7));
  const first = addDays(monday, -(weekCount - 1) * 7);
  const todayKey = dayKey(today);

  let most = 0;
  const shownDays: CalendarDay[] = [];
  for (let i = 0; i < weekCount * 7; i++) {
    const date = addDays(first, i);
    const day = dayKey(date);
    const words = days.get(day)?.words;
    if (words !== undefined) most = Math.max(most, words);
    shownDays.push({
      day,
      date,
      level: 0,
      words: words ?? 0,
      isFuture: day > todayKey,
      isBeforeStart: day < startedOn,
    });
  }
  for (const shown of shownDays) {
    shown.level = days.has(shown.day)
      ? calendarLevel(shown.words, most)
      : 0;
  }

  const monthName = new Intl.DateTimeFormat(locale, { month: "short" });
  const weeks: CalendarWeek[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weekCount; w++) {
    const weekDays = shownDays.slice(w * 7, w * 7 + 7);
    const month = weekDays[0].date.getMonth();
    weeks.push({
      label: month === lastMonth ? "" : monthName.format(weekDays[0].date),
      days: weekDays,
    });
    lastMonth = month;
  }
  // The first column's month may be nearly over; its name would run into
  // the next one's.
  if (weeks.slice(1, 3).some((week) => week.label)) weeks[0].label = "";
  return weeks;
}

/** The day the page opens on: the last day you wrote, or today. */
export function latestDay(days: Map<string, DayTotal>, today: Date) {
  let latest: string | null = null;
  for (const day of days.keys()) {
    if (latest === null || day > latest) latest = day;
  }
  return latest ?? dayKey(today);
}
