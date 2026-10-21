import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { LeftSidebarToggle } from "@/components/PanelToggles";
import { Separator } from "@/components/ui/separator";
import {
  buildCalendar,
  dayKey,
  latestDay,
  monthTotals,
  parseDay,
  totalsByDay,
  type ChartShard,
  type DayTotal,
  type WritingEntry,
} from "@/lib/data";
import {
  getFolderInVault,
  getVaultFileDisplayName,
} from "@/lib/drawing-files";
import { folderName } from "@/lib/open-vault";
import { openDeletedShardHistory } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import { useAttachmentReportStore, useVaultStore } from "@/store";
import { DATA_SECTIONS, useDataStore, type DataSection } from "@/store/data";
import { Health } from "./Health";
import {
  LINK_ROW_CLASS,
  LIST_CLASS,
  LIST_ROW_CLASS,
  OpenLabel,
  openShard,
  plural,
} from "./rows";
import { CalendarKey, WritingCalendar } from "./WritingCalendar";

const YEAR_WEEKS = 53;
/** A picked day lists this many shards until you ask for all of them. */
const DAY_SHARDS_SHOWN = 6;

/**
 * Set while the page scrolls to a section picked in the sidebar, so the
 * scroll doesn't mark another one; cleared once scrolling stops.
 */
let sectionPinTimer: number | null = null;

function pinSection() {
  if (sectionPinTimer !== null) clearTimeout(sectionPinTimer);
  sectionPinTimer = window.setTimeout(() => {
    sectionPinTimer = null;
  }, 150);
}

/**
 * Scrolls the Overview page to `section`, for the sidebar's list, and marks
 * its title, which is all that shows when the page can't scroll there.
 */
export function showDataSection(section: DataSection) {
  useDataStore.getState().setSection(section);
  pinSection();
  document
    .getElementById(`data-${section}`)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });

  const title = document.getElementById(`data-${section}-title`);
  if (title) {
    const accent = getComputedStyle(title).getPropertyValue("--accent");
    title.animate(
      [{ backgroundColor: accent }, { backgroundColor: "transparent" }],
      { duration: 1200, easing: "ease-out" },
    );
  }
}

function Tile({
  label,
  value,
  detail,
}: {
  label: string;
  value: number;
  detail?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-4 py-3.5">
      <span className="text-muted-foreground text-ui-sm">{label}</span>
      <span className="font-semibold text-[22px] leading-7 tabular-nums">
        {value.toLocaleString()}
      </span>
      {detail ? (
        <span className="text-muted-foreground text-ui-sm">{detail}</span>
      ) : null}
    </div>
  );
}

function DayShards({
  day,
  total,
  vaultPath,
}: {
  day: string;
  total: DayTotal | undefined;
  vaultPath: string;
}) {
  const date = parseDay(day).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const shards = total?.shards ?? [];
  const [showAll, setShowAll] = useState(false);
  // Shards that still exist first, then the deleted ones in their own group;
  // the cap counts both.
  const ordered = [
    ...shards.filter((entry) => entry.exists),
    ...shards.filter((entry) => !entry.exists),
  ];
  const shown = showAll ? ordered : ordered.slice(0, DAY_SHARDS_SHOWN);
  const kept = shown.filter((entry) => entry.exists);
  const deleted = shown.filter((entry) => !entry.exists);

  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="px-3 pb-1 font-normal text-muted-foreground text-ui-sm">
        {date} ·{" "}
        {shards.length === 0
          ? "nothing written"
          : plural(shards.length, "shard", "shards")}
      </h3>
      {kept.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {kept.map((entry) => (
            <DayShard key={entry.path} entry={entry} vaultPath={vaultPath} />
          ))}
        </ul>
      ) : null}
      {deleted.length > 0 ? (
        <>
          <h4
            className={cn(
              "px-3 pb-1 font-normal text-muted-foreground text-ui-sm",
              kept.length > 0 && "pt-3",
            )}
          >
            Deleted
          </h4>
          <ul aria-label="Deleted" className="flex flex-col gap-0.5">
            {deleted.map((entry) => (
              <DayShard key={entry.path} entry={entry} vaultPath={vaultPath} />
            ))}
          </ul>
        </>
      ) : null}
      {shown.length < ordered.length ? (
        <button
          type="button"
          className={cn(LINK_ROW_CLASS, "text-muted-foreground")}
          onClick={() => setShowAll(true)}
        >
          Show all {ordered.length.toLocaleString()}
        </button>
      ) : null}
    </div>
  );
}

function DayShard({
  entry,
  vaultPath,
}: {
  entry: WritingEntry;
  vaultPath: string;
}) {
  const folder = getFolderInVault(entry.path, vaultPath);
  const content = (
    <>
      <span className="min-w-0 truncate font-medium">
        {getVaultFileDisplayName(entry.name)}
      </span>
      <span className="min-w-0 shrink truncate text-muted-foreground text-ui-sm">
        {folder}
      </span>
      <span className="ml-auto shrink-0 text-muted-foreground text-ui-sm tabular-nums">
        +{plural(entry.words, "word", "words")}
      </span>
    </>
  );

  // A deleted shard opens its history, to bring it back.
  const open = entry.exists
    ? () => void openShard(entry.path)
    : entry.has_history
      ? () => openDeletedShardHistory(entry.path)
      : null;

  return (
    <li>
      {open ? (
        <button type="button" className={LINK_ROW_CLASS} onClick={open}>
          {content}
        </button>
      ) : (
        <div className={cn(LIST_ROW_CLASS, "text-muted-foreground")}>
          {content}
        </div>
      )}
    </li>
  );
}

function Writing({ vaultPath }: { vaultPath: string }) {
  const log = useDataStore((s) => s.log);
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const today = new Date();
  const todayKey = dayKey(today);

  const days = useMemo(() => totalsByDay(log?.entries ?? []), [log]);
  const weeks = useMemo(
    () =>
      buildCalendar({
        days,
        today: parseDay(todayKey),
        startedOn: log?.started_on ?? todayKey,
        weekCount: YEAR_WEEKS,
      }),
    [days, todayKey, log?.started_on],
  );

  if (!log) return null;

  const month = monthTotals(days, today);
  const hasWriting = days.size > 0;
  const shownDay = pickedDay ?? latestDay(days, today);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Shards" value={log.shard_count} />
        <Tile label="Words" value={log.word_count} />
        <Tile label="This month" value={month.words} detail="words written" />
        <Tile
          label="Days written"
          value={month.daysWritten}
          detail={`of ${month.daysSoFar} this month`}
        />
      </div>

      {hasWriting ? (
        <div className="flex flex-col gap-2.5 rounded-lg border bg-card p-4">
          <WritingCalendar
            weeks={weeks}
            pickedDay={shownDay}
            onPick={setPickedDay}
          />
          <div className="flex justify-end text-muted-foreground text-ui-sm">
            <CalendarKey />
          </div>
        </div>
      ) : (
        <div className="relative rounded-lg border bg-card p-4">
          <div className="opacity-35">
            <WritingCalendar weeks={weeks} pickedDay={todayKey} isInert />
          </div>
          <div className="absolute inset-0 flex items-center justify-center px-20 text-center">
            <span className="font-semibold text-ui">
              Your calendar starts today
            </span>
          </div>
        </div>
      )}

      {hasWriting ? (
        <DayShards
          key={shownDay}
          day={shownDay}
          total={days.get(shownDay)}
          vaultPath={vaultPath}
        />
      ) : null}
    </>
  );
}

/** The shards with charts, each opening in the Editor. */
function Charts({
  shards,
  vaultPath,
}: {
  shards: ChartShard[];
  vaultPath: string;
}) {
  return (
    <ul className={LIST_CLASS}>
      {shards.map((shard) => (
        <li key={shard.path}>
          <button
            type="button"
            className={LINK_ROW_CLASS}
            onClick={() => void openShard(shard.path)}
          >
            <span className="min-w-0 truncate">
              {getVaultFileDisplayName(shard.name)}
            </span>
            <span className="min-w-0 shrink truncate text-muted-foreground text-ui-sm">
              {getFolderInVault(shard.path, vaultPath)}
            </span>
            <span className="shrink-0 text-muted-foreground text-ui-sm tabular-nums">
              {plural(shard.charts, "chart", "charts")}
            </span>
            <OpenLabel />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The vault's attachment report, checked again on each visit. */
function useAttachmentReport(vaultPath: string | null, version: number) {
  const check = useAttachmentReportStore((s) => s.check);
  const report = useAttachmentReportStore((s) =>
    s.vaultPath === vaultPath ? s.report : null,
  );

  useEffect(() => {
    if (vaultPath) void check(vaultPath);
  }, [vaultPath, version, check]);

  return report;
}

function Section({
  id,
  title,
  className,
  children,
}: {
  id: DataSection;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`data-${id}`}
      aria-labelledby={`data-${id}-title`}
      className={cn("flex scroll-mt-10 flex-col gap-3", className)}
    >
      <h2
        id={`data-${id}-title`}
        className="-mx-1.5 rounded-md px-1.5 font-semibold text-lg tracking-tight"
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The Overview page: your writing in this vault, its charts and its health. */
export function DataView() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const log = useDataStore((s) => s.log);
  const brokenLinks = useDataStore((s) => s.brokenLinks);
  const chartShards = useDataStore((s) => s.chartShards);
  const status = useDataStore((s) => s.status);
  const version = useDataStore((s) => s.version);
  const load = useDataStore((s) => s.load);
  const setSection = useDataStore((s) => s.setSection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const report = useAttachmentReport(vaultPath, version);
  const pendingSection = useDataStore((s) => s.pendingSection);
  const hasContent = !!log && !!vaultPath && status !== "error";

  // Asked for from elsewhere, such as the broken links toast.
  useLayoutEffect(() => {
    if (!hasContent || !pendingSection) return;
    useDataStore.getState().scrollToOnOpen(null);
    showDataSection(pendingSection);
  }, [hasContent, pendingSection]);

  // Loads on each visit, since saves change the figures, and again if the
  // index changes while the page is open.
  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, version, load]);

  // The sidebar marks the last section whose top has scrolled past the top
  // of the page, or the last one once the page can't scroll further.
  function trackSection() {
    if (sectionPinTimer !== null) {
      pinSection();
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) return;
    const top = scroller.getBoundingClientRect().top + 80;
    const atEnd =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    let current: DataSection = DATA_SECTIONS[0].id;
    for (const { id } of DATA_SECTIONS) {
      const section = document.getElementById(`data-${id}`);
      if (section && (atEnd || section.getBoundingClientRect().top <= top)) {
        current = id;
      }
    }
    setSection(current);
  }

  let content: React.ReactNode = null;
  if (status === "error") {
    content = (
      <p className="mt-24 text-center text-muted-foreground text-ui">
        Overview couldn't be loaded.
      </p>
    );
  } else if (log && vaultPath) {
    content = (
      <>
        <h1 className="font-semibold text-2xl tracking-tight">
          {folderName(vaultPath)}
        </h1>
        <p className="mt-1 mb-7 text-muted-foreground text-ui-sm">
          {plural(log.shard_count, "shard", "shards")}
        </p>

        <Section id="writing" title="Writing" className="gap-4">
          <Writing vaultPath={vaultPath} />
        </Section>

        {chartShards.length > 0 ? (
          <>
            <Separator className="my-9" />
            <Section id="charts" title="Charts">
              <Charts shards={chartShards} vaultPath={vaultPath} />
            </Section>
          </>
        ) : null}

        <Separator className="my-9" />

        <Section id="health" title="Health">
          <Health links={brokenLinks} report={report} vaultPath={vaultPath} />
        </Section>
      </>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-header shrink-0 items-center gap-1.5 border-b px-2.5">
        <LeftSidebarToggle />
        <Separator
          orientation="vertical"
          className="mx-1 h-4 data-vertical:self-center"
        />
        <span className="px-1.5 font-medium text-ui">Overview</span>
      </header>
      <div
        ref={scrollRef}
        onScroll={trackSection}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-10"
      >
        <div className="mx-auto max-w-180">{content}</div>
      </div>
    </div>
  );
}
