import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleCheckIcon } from "lucide-react";

import { LeftSidebarToggle } from "@/components/PanelToggles";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  buildCalendar,
  dayKey,
  latestDay,
  monthTotals,
  parseDay,
  totalsByDay,
  type BrokenLink,
  type DayTotal,
  type WritingEntry,
} from "@/lib/data";
import {
  getFolderInVault,
  getVaultFileDisplayName,
} from "@/lib/drawing-files";
import { getAssetLabel } from "@/components/settings/attachment-format";
import type { MissingAttachment } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { folderName } from "@/lib/open-vault";
import { openDeletedShardHistory } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import {
  useAttachmentReportStore,
  useEditorStore,
  useUIStore,
  useVaultStore,
} from "@/store";
import { DATA_SECTIONS, useDataStore, type DataSection } from "@/store/data";
import { CalendarKey, WritingCalendar } from "./WritingCalendar";

const HALF_YEAR_WEEKS = 27;
const YEAR_WEEKS = 53;

function plural(count: number, one: string, many: string) {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

async function openShard(path: string): Promise<boolean> {
  try {
    await openEditorFile(path);
    useUIStore.getState().openMode("editor");
    return true;
  } catch (error) {
    console.error("[Netherstone] Failed to open shard from Overview:", error);
    return false;
  }
}

/** Scrolls the Overview page to `section`, for the sidebar's list. */
export function showDataSection(section: DataSection) {
  useDataStore.getState().setSection(section);
  document
    .getElementById(`data-${section}`)
    ?.scrollIntoView({ block: "start", behavior: "smooth" });
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

const LIST_ROW_CLASS =
  "flex w-full min-w-0 items-baseline gap-2.5 rounded-lg px-3 py-2 text-left text-ui outline-none transition-colors";
const LINK_ROW_CLASS = cn(
  LIST_ROW_CLASS,
  "hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring",
);

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

  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="px-3 pb-1 font-normal text-muted-foreground text-ui-sm">
        {date} ·{" "}
        {shards.length === 0
          ? "nothing written"
          : plural(shards.length, "shard", "shards")}
      </h3>
      {shards.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {shards.map((entry) => (
            <DayShard key={entry.path} entry={entry} vaultPath={vaultPath} />
          ))}
        </ul>
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
        {entry.exists ? folder : "Deleted"}
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
  const [showYear, setShowYear] = useState(false);
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
        weekCount: showYear ? YEAR_WEEKS : HALF_YEAR_WEEKS,
      }),
    [days, todayKey, log?.started_on, showYear],
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
          <div className="flex items-center">
            <span className="text-muted-foreground text-ui-sm">
              {showYear ? "Last 12 months" : "Last 6 months"}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={() => setShowYear((year) => !year)}
            >
              {showYear ? "Show the last 6 months" : "Show the whole year"}
            </Button>
          </div>
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
          day={shownDay}
          total={days.get(shownDay)}
          vaultPath={vaultPath}
        />
      ) : null}
    </>
  );
}

/** Opens the shard holding `link`, scrolled to the link. */
async function openBrokenLink(link: BrokenLink) {
  const { setPendingLinkReveal } = useEditorStore.getState();
  setPendingLinkReveal({ path: link.path, text: link.text });
  if (!(await openShard(link.path))) setPendingLinkReveal(null);
}

/** Opens a shard that embeds a missing file, scrolled to the embed. */
async function openMissingFile(shardPath: string, assetPath: string) {
  const { setPendingLinkReveal } = useEditorStore.getState();
  setPendingLinkReveal({ path: shardPath, assetPath });
  if (!(await openShard(shardPath))) setPendingLinkReveal(null);
}

/** One row per shard embedding each missing file. */
export function missingFileRows(missing: MissingAttachment[]) {
  return missing.flatMap((file) =>
    file.shardPaths.map((shardPath) => ({
      assetPath: file.assetPath,
      name: file.originalName ?? getAssetLabel(file.assetPath),
      shardPath,
    })),
  );
}

function OpenLabel() {
  return (
    <span className="ml-auto shrink-0 text-chart-4 text-ui-sm dark:text-chart-2">
      Open
    </span>
  );
}

function BrokenLinks({
  links,
  missing,
}: {
  links: BrokenLink[];
  missing: MissingAttachment[];
}) {
  const missingRows = missingFileRows(missing);
  if (links.length === 0 && missingRows.length === 0) {
    return (
      <div className="flex items-center gap-2.5 rounded-lg border bg-card p-4 text-ui">
        <CircleCheckIcon className="size-5 shrink-0 text-chart-3" />
        No broken links.
      </div>
    );
  }

  return (
    <ul className="flex flex-col rounded-lg border bg-card p-1.5">
      {links.map((link, i) => (
        <li key={`${link.path}-${i}`}>
          <button
            type="button"
            className={LINK_ROW_CLASS}
            onClick={() => void openBrokenLink(link)}
          >
            <span className="min-w-0 truncate">@{link.text}</span>
            <span className="min-w-0 shrink truncate text-muted-foreground text-ui-sm">
              in {getVaultFileDisplayName(link.name)}
            </span>
            <OpenLabel />
          </button>
        </li>
      ))}
      {missingRows.map((row) => (
        <li key={`${row.assetPath}-${row.shardPath}`}>
          <button
            type="button"
            className={LINK_ROW_CLASS}
            title={row.assetPath}
            onClick={() => void openMissingFile(row.shardPath, row.assetPath)}
          >
            <span className="min-w-0 truncate">{row.name}</span>
            <span className="min-w-0 shrink truncate text-muted-foreground text-ui-sm">
              in{" "}
              {getVaultFileDisplayName(
                row.shardPath.split(/[\\/]/).pop() ?? row.shardPath,
              )}
            </span>
            <OpenLabel />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The missing files in the vault's attachment report, checked on each visit. */
function useMissingFiles(vaultPath: string | null, version: number) {
  const check = useAttachmentReportStore((s) => s.check);
  const missing = useAttachmentReportStore((s) =>
    s.vaultPath === vaultPath ? (s.report?.missing ?? null) : null,
  );

  useEffect(() => {
    if (vaultPath) void check(vaultPath);
  }, [vaultPath, version, check]);

  return missing ?? [];
}

/** The Overview page: your writing in this vault, then its broken links. */
export function DataView() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const log = useDataStore((s) => s.log);
  const brokenLinks = useDataStore((s) => s.brokenLinks);
  const status = useDataStore((s) => s.status);
  const version = useDataStore((s) => s.version);
  const load = useDataStore((s) => s.load);
  const setSection = useDataStore((s) => s.setSection);
  const scrollRef = useRef<HTMLDivElement>(null);
  const missing = useMissingFiles(vaultPath, version);
  const pendingSection = useDataStore((s) => s.pendingSection);
  const hasContent = !!log && !!vaultPath && status !== "error";

  // Asked for from elsewhere, such as the missing files toast.
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

        <section
          id="data-writing"
          aria-labelledby="data-writing-title"
          className="flex scroll-mt-10 flex-col gap-4"
        >
          <h2
            id="data-writing-title"
            className="font-semibold text-lg tracking-tight"
          >
            Writing
          </h2>
          <Writing vaultPath={vaultPath} />
        </section>

        <Separator className="my-9" />

        <section
          id="data-broken-links"
          aria-labelledby="data-broken-links-title"
          className="flex scroll-mt-10 flex-col gap-3"
        >
          <h2
            id="data-broken-links-title"
            className="font-semibold text-lg tracking-tight"
          >
            Broken links
          </h2>
          <BrokenLinks links={brokenLinks} missing={missing} />
        </section>
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
