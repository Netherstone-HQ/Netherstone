import { useEffect, useMemo, useState } from "react";

import { LeftSidebarToggle } from "@/components/PanelToggles";
import { Separator } from "@/components/ui/separator";
import {
  chartData,
  parseChartComment,
  type ChartData,
  type ChartSpec,
} from "@/lib/chart";
import {
  buildCalendar,
  dayKey,
  latestDay,
  monthTotals,
  parseDay,
  totalsByDay,
  type DayTotal,
  type ShardChart,
  type WritingEntry,
} from "@/lib/data";
import { getFolderInVault, getVaultFileDisplayName } from "@/lib/drawing-files";
import { folderName } from "@/lib/open-vault";
import { openDeletedShardHistory } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import { useAttachmentReportStore, useVaultStore } from "@/store";
import { useDataStore } from "@/store/data";
import { ChartSvg } from "./ChartSvg";
import { Health } from "./Health";
import {
  Card,
  GROUP_LABEL_CLASS,
  LINK_ROW_CLASS,
  LIST_ROW_CLASS,
  openShard,
  openShardAt,
  plural,
} from "./rows";
import { WritingCalendar } from "./WritingCalendar";

const YEAR_WEEKS = 53;
/** A picked day lists this many shards until you ask for all of them. */
const DAY_SHARDS_SHOWN = 6;
/** Charts shown until you ask for all of them, the last edited first. */
const CHARTS_SHOWN = 4;

function Tile({
  label,
  value,
  of,
}: {
  label: string;
  value: number;
  /** What `value` is out of, shown after it. */
  of?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border bg-card px-4 py-3">
      <span className="truncate text-muted-foreground text-ui-sm">{label}</span>
      <span className="font-semibold text-[22px] leading-7 tabular-nums">
        {value.toLocaleString()}
        {of !== undefined ? (
          <span className="font-normal text-muted-foreground text-ui">
            {" "}
            / {of.toLocaleString()}
          </span>
        ) : null}
      </span>
    </div>
  );
}

function DayShards({
  day,
  total,
  vaultPath,
  className,
}: {
  day: string;
  total: DayTotal | undefined;
  vaultPath: string;
  className?: string;
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
    <Card
      title={date}
      aside={
        shards.length === 0
          ? "Nothing written"
          : plural(shards.length, "shard", "shards")
      }
      isList
      // Beside the calendar, as tall as it and the tiles, scrolling past that.
      className={cn(className, "@4xl:relative")}
      bodyClassName="@4xl:absolute @4xl:inset-0 @4xl:overflow-y-auto"
    >
      {kept.length > 0 ? (
        <ul>
          {kept.map((entry) => (
            <DayShard key={entry.path} entry={entry} vaultPath={vaultPath} />
          ))}
        </ul>
      ) : null}
      {deleted.length > 0 ? (
        <div>
          <h3 className={GROUP_LABEL_CLASS}>Deleted</h3>
          <ul aria-label="Deleted">
            {deleted.map((entry) => (
              <DayShard key={entry.path} entry={entry} vaultPath={vaultPath} />
            ))}
          </ul>
        </div>
      ) : null}
      {shown.length < ordered.length ? (
        <ShowAll count={ordered.length} onClick={() => setShowAll(true)} />
      ) : null}
    </Card>
  );
}

function ShowAll({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      className={cn(
        LINK_ROW_CLASS,
        "w-auto self-start text-muted-foreground text-ui-sm",
      )}
      onClick={onClick}
    >
      Show all {count.toLocaleString()}
    </button>
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
      <span className="min-w-0 truncate">
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

/**
 * The tiles and the calendar, with the picked day's shards beside them on a
 * wide page.
 */
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
      <div
        className={cn(
          "flex min-w-0 flex-col gap-4",
          hasWriting ? "@4xl:col-span-2" : "@4xl:col-span-3",
        )}
      >
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          <Tile label="Shards" value={log.shard_count} />
          <Tile label="Words" value={log.word_count} />
          <Tile label="Words this month" value={month.words} />
          <Tile
            label="Days this month"
            value={month.daysWritten}
            of={month.daysSoFar}
          />
        </div>

        <Card title="Writing">
          {hasWriting ? (
            <WritingCalendar
              weeks={weeks}
              pickedDay={shownDay}
              onPick={setPickedDay}
            />
          ) : (
            <div className="relative">
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
        </Card>
      </div>

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

/** Each chart drawn small, opening its shard at the chart. */
function Charts({
  charts,
  vaultPath,
  className,
}: {
  charts: DrawnChart[];
  vaultPath: string;
  className?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? charts : charts.slice(0, CHARTS_SHOWN);

  return (
    <Card title="Charts" className={className}>
      <ul className="grid gap-3 @lg:grid-cols-2">
        {shown.map((chart) => (
          <ChartPreview
            key={`${chart.chart.path}-${chart.chart.index}`}
            {...chart}
            vaultPath={vaultPath}
          />
        ))}
      </ul>
      {shown.length < charts.length ? (
        <div className="-mx-2.5 -mb-2.5">
          <ShowAll count={charts.length} onClick={() => setShowAll(true)} />
        </div>
      ) : null}
    </Card>
  );
}

function ChartPreview({
  chart,
  spec,
  data,
  vaultPath,
}: DrawnChart & { vaultPath: string }) {
  const name = getVaultFileDisplayName(chart.name);
  const detail = spec.title || getFolderInVault(chart.path, vaultPath);

  return (
    <li className="min-w-0">
      <button
        type="button"
        className="flex w-full flex-col gap-2 rounded-md border px-3 pt-2.5 pb-3 text-left text-ui outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() =>
          void openShardAt({ path: chart.path, chart: chart.index })
        }
      >
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate">{name}</span>
          {detail ? (
            <span className="min-w-0 shrink truncate text-muted-foreground text-ui-sm">
              {detail}
            </span>
          ) : null}
        </span>
        <ChartSvg
          kind={spec.kind}
          data={data}
          label={spec.title || name}
          isCompact
        />
      </button>
    </li>
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

interface DrawnChart {
  chart: ShardChart;
  spec: ChartSpec;
  data: ChartData;
}

/** The charts that draw something: a table with numbers above them. */
function useDrawnCharts() {
  const charts = useDataStore((s) => s.charts);
  return useMemo(
    () =>
      charts.flatMap((chart): DrawnChart[] => {
        const spec = parseChartComment(chart.comment);
        if (!spec) return [];
        const data = chartData(spec, {
          columns: chart.columns,
          rows: chart.rows,
        });
        return data.series.length > 0 ? [{ chart, spec, data }] : [];
      }),
    [charts],
  );
}

/** The Overview page: your writing in this vault, its charts and its health. */
export function DataView() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const log = useDataStore((s) => s.log);
  const brokenLinks = useDataStore((s) => s.brokenLinks);
  const charts = useDrawnCharts();
  const status = useDataStore((s) => s.status);
  const version = useDataStore((s) => s.version);
  const load = useDataStore((s) => s.load);
  const report = useAttachmentReport(vaultPath, version);

  // Loads on each visit, since saves change the figures, and again if the
  // index changes while the page is open.
  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, version, load]);

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
        <h1 className="mb-5 font-semibold text-2xl tracking-tight">
          {folderName(vaultPath)}
        </h1>
        {/* One column, or three once the calendar and the picked day fit
            side by side. */}
        <div className="grid gap-4 @4xl:grid-cols-3">
          <Writing vaultPath={vaultPath} />
          {charts.length > 0 ? (
            <Charts
              charts={charts}
              vaultPath={vaultPath}
              className="@4xl:col-span-2"
            />
          ) : null}
          <Health
            links={brokenLinks}
            report={report}
            vaultPath={vaultPath}
            className={charts.length > 0 ? undefined : "@4xl:col-span-3"}
          />
        </div>
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
      <div className="@container min-h-0 flex-1 overflow-y-auto px-6 py-8">
        <div className="mx-auto max-w-275">{content}</div>
      </div>
    </div>
  );
}
