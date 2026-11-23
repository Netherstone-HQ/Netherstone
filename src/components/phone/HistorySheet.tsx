import { Fragment } from "react";
import { ChevronRightIcon, XIcon } from "lucide-react";
import { useFileHistory } from "@/components/history/HistoryPanel";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { isDrawingPath } from "@/lib/drawing-files";
import {
  describeVersion,
  formatDay,
  formatTime,
  groupByDay,
  namesDevices,
  type FileVersion,
} from "@/lib/history";
import { useHistoryStore } from "@/store/history";
import { usePhoneNav } from "./nav";
import { PhoneIconButton } from "./parts";

function DayLabel({ children }: { children: string }) {
  return (
    <h3 className="px-4 pt-4 pb-1.5 text-sm text-muted-foreground first:pt-1">
      {children}
    </h3>
  );
}

function Row({
  time,
  detail,
  end,
  onPick,
}: {
  time: string;
  detail: string | null;
  end: React.ReactNode;
  onPick?: () => void;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-medium">{time}</span>
        {detail ? (
          <span className="truncate text-sm text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
      {end}
    </>
  );
  const className = "flex min-h-16 w-full items-center gap-3 px-4 text-left";
  return onPick ? (
    <button
      type="button"
      className={`${className} outline-none active:bg-accent`}
      onClick={onPick}
    >
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * The open shard's history: now, then its earlier versions by day. Picking
 * one shows it on its own screen.
 */
export function HistorySheet({
  filePath,
  open,
  onOpenChange,
}: {
  filePath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const history = useFileHistory(filePath);
  const pickVersion = useHistoryStore((s) => s.pickVersion);
  const push = usePhoneNav((s) => s.push);
  const isDrawing = isDrawingPath(filePath);
  const versions = history?.versions ?? null;
  const current = history?.current ?? null;
  const days = versions ? groupByDay(versions) : [];
  const currentDay = current === null ? "Today" : formatDay(current.time);
  const sharesDay = days[0]?.label === currentDay;
  const showsDevices = history !== null && namesDevices(history);

  const describe = (version: FileVersion) =>
    [showsDevices ? version.device : null, describeVersion(version, isDrawing)]
      .filter(Boolean)
      .join(" • ");

  const pick = (version: FileVersion) => {
    pickVersion(version);
    push({ kind: "version" });
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      height="half"
      title={
        <span className="text-base font-semibold text-foreground">History</span>
      }
      actions={
        <PhoneIconButton
          label="Close history"
          onClick={() => onOpenChange(false)}
        >
          <XIcon />
        </PhoneIconButton>
      }
    >
      {versions === null ? null : versions.length === 0 ? (
        <p className="px-4 pt-10 text-center text-muted-foreground">
          No earlier versions yet
        </p>
      ) : (
        <div className="pb-4">
          <DayLabel>{currentDay}</DayLabel>
          <Row
            time={current === null ? "Now" : formatTime(current.time)}
            detail={current === null ? null : describe(current)}
            end={<span className="text-sm text-muted-foreground">Current</span>}
          />
          {days.map((day, index) => (
            <Fragment key={day.label}>
              {index === 0 && sharesDay ? null : (
                <DayLabel>{day.label}</DayLabel>
              )}
              {day.versions.map((version) => (
                <Row
                  key={version.id}
                  time={formatTime(version.time)}
                  detail={describe(version)}
                  end={
                    <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
                  }
                  onPick={() => pick(version)}
                />
              ))}
            </Fragment>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
