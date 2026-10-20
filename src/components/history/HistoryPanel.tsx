import { useEffect, useRef, useState } from "react";
import { HistoryIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { isDrawingPath } from "@/lib/drawing-files";
import {
  describeVersion,
  formatTime,
  groupByDay,
  listVersions,
  type FileVersion,
} from "@/lib/history";
import { cn } from "@/lib/utils";
import { type HistoryPlace, useHistoryStore } from "@/store/history";
import { useVaultStore } from "@/store/vault";

/** The open file's versions, newest first, loaded again as new ones are saved. */
function useVersions(filePath: string) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const tick = useHistoryStore((s) => s.versionsTick);
  const [loaded, setLoaded] = useState<{
    filePath: string;
    versions: FileVersion[];
  } | null>(null);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    // A long history comes back with the older lines still to work out;
    // each listing gets further, so keep listing until they're all there.
    const load = (): Promise<void> =>
      listVersions(vaultPath, filePath).then((versions) => {
        if (cancelled) return;
        setLoaded({ filePath, versions });
        if (versions.some((version) => !version.counted)) return load();
      });
    load().catch((error) => {
      console.error("[Netherstone] Couldn't list versions:", error);
      if (!cancelled) setLoaded({ filePath, versions: [] });
    });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, filePath, tick]);

  return loaded?.filePath === filePath ? loaded.versions : null;
}

function VersionRow({
  time,
  detail,
  isCurrent,
  isPicked,
  onPick,
}: {
  time: string;
  detail?: string;
  isCurrent?: boolean;
  isPicked: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-current={isPicked ? "true" : undefined}
      data-history-row=""
      className={cn(
        "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent/60 focus-visible:ring-3 focus-visible:ring-ring/50",
        isPicked && "bg-sidebar-accent hover:bg-sidebar-accent",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="font-medium">{time}</span>
        {isCurrent ? (
          <span className="rounded-sm bg-muted-foreground/15 px-1.5 text-xs leading-4 text-muted-foreground">
            Current
          </span>
        ) : null}
      </span>
      {detail ? (
        <span className="text-ui-sm text-muted-foreground">{detail}</span>
      ) : null}
    </button>
  );
}

function DayLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pt-3 pb-1.5 text-ui-sm text-muted-foreground first:pt-1">
      {children}
    </div>
  );
}

/**
 * The history of the open shard or drawing, in the right sidebar's place:
 * "Now", then its earlier versions by day. Picking one shows it in place of
 * the file.
 */
export function HistoryPanel({
  place,
  filePath,
}: {
  place: HistoryPlace;
  filePath: string;
}) {
  const versions = useVersions(filePath);
  // A deleted shard has no "Now": its last version shows first.
  const isDeleted = useHistoryStore(
    (s) => place === "notes" && s.deletedPath === filePath,
  );
  const picked = useHistoryStore((s) => s.picked);
  const pickVersion = useHistoryStore((s) => s.pickVersion);
  const closeHistory = useHistoryStore((s) => s.closeHistory);
  const listRef = useRef<HTMLDivElement>(null);
  const isDrawing = isDrawingPath(filePath);

  // Another file opened: show it as it is now.
  const shownPathRef = useRef(filePath);
  useEffect(() => {
    if (shownPathRef.current === filePath) return;
    shownPathRef.current = filePath;
    pickVersion(null);
  }, [filePath, pickVersion]);

  // A version that's no longer listed (it became "Now") isn't shown.
  useEffect(() => {
    if (picked && versions && !versions.some((v) => v.id === picked.id)) {
      pickVersion(null);
    } else if (!picked && isDeleted && versions?.[0]) {
      pickVersion(versions[0]);
    }
  }, [picked, versions, isDeleted, pickVersion]);

  const moveFocus = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-history-row]",
      ) ?? [],
    );
    const index = rows.indexOf(document.activeElement as HTMLButtonElement);
    const next = rows[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
    next.click();
  };

  const days = versions ? groupByDay(versions) : [];
  const hasToday = !isDeleted && days[0]?.label === "Today";

  return (
    <aside
      aria-label="History"
      className="flex h-full w-80 flex-col border-l bg-sidebar text-ui text-sidebar-foreground"
    >
      <div className="flex h-header shrink-0 items-center border-b border-sidebar-border pr-2.5 pl-4">
        <span className="font-medium">History</span>
        <Hint label="Close history" side="bottom">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={closeHistory}
            aria-label="Close history"
            className="ml-auto text-muted-foreground hover:text-foreground"
          >
            <XIcon />
          </Button>
        </Hint>
      </div>

      {versions === null ? null : versions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <HistoryIcon className="size-4.5" />
          </div>
          <p className="font-medium">No earlier versions yet</p>
        </div>
      ) : (
        <div
          ref={listRef}
          onKeyDown={moveFocus}
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2"
        >
          {isDeleted ? null : (
            <>
              <DayLabel>Today</DayLabel>
              <VersionRow
                time="Now"
                isCurrent
                isPicked={picked === null}
                onPick={() => pickVersion(null)}
              />
            </>
          )}
          {days.map((day, index) => (
            <div key={day.label} className="contents">
              {index === 0 && hasToday ? null : (
                <DayLabel>{day.label}</DayLabel>
              )}
              {day.versions.map((version) => (
                <VersionRow
                  key={version.id}
                  time={formatTime(version.time)}
                  detail={describeVersion(version, isDrawing)}
                  isPicked={picked?.id === version.id}
                  onPick={() => pickVersion(version)}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
