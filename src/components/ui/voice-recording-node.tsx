import * as React from "react";

import {
  Check,
  ChevronDown,
  CircleAlert,
  Mic,
  Pause,
  Trash2,
} from "lucide-react";
import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  microphoneSettingsAvailable,
  openMicrophoneSettings,
} from "@/lib/commands/voice-notes";
import { listMicrophones } from "@/lib/voice/capture";
import {
  discard,
  pauseVoiceNote,
  registerVoiceNoteFocus,
  resumeVoiceNote,
  retryVoiceNote,
  save,
  subscribeMeter,
  switchVoiceNoteInput,
  useVoiceNoteStore,
  type VoiceNoteProblem,
  WAVE_BARS,
} from "@/lib/voice/voice-note";
import { findShortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";

/** The file turns amber this close to the sync limit. */
const NEAR_LIMIT_SHARE = 0.9;
const BYTES_PER_MB = 1024 * 1024;
const BAR_MIN_PX = 3;
const BAR_MAX_PX = 28;

const PROBLEM_TEXT: Record<VoiceNoteProblem, string> = {
  "access-off": "Microphone access is off for Netherstone",
  "no-microphone": "No microphone found",
  "disk-full": "The disk is full. The recording isn't saved yet",
  failed: "Couldn't write the recording. It isn't saved yet",
};

export function formatClock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatMb(bytes: number): string {
  return (bytes / BYTES_PER_MB).toFixed(1);
}

const boxClass =
  "flex h-14 items-center gap-3 rounded-xl border border-border bg-card pr-2.5 pl-4 text-card-foreground shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** The wave, timer and size, drawn straight from the meter. */
function Meter({ paused }: { paused: boolean }) {
  const timeRef = React.useRef<HTMLSpanElement>(null);
  const sizeRef = React.useRef<HTMLSpanElement>(null);
  const waveRef = React.useRef<HTMLDivElement>(null);
  const syncLimitBytes = useVoiceNoteStore((s) => s.syncLimitBytes);

  React.useEffect(
    () =>
      subscribeMeter(({ durationMs, bytes, levels }) => {
        const near =
          syncLimitBytes > 0 && bytes >= syncLimitBytes * NEAR_LIMIT_SHARE;
        if (timeRef.current) {
          timeRef.current.textContent = formatClock(durationMs);
          timeRef.current.dataset.near = String(near);
        }
        if (sizeRef.current) {
          sizeRef.current.hidden = !near;
          sizeRef.current.textContent = `${formatMb(bytes)} of ${formatMb(syncLimitBytes)} MB`;
        }
        const bars = waveRef.current?.children;
        if (!bars) return;
        const offset = bars.length - levels.length;
        for (let index = 0; index < bars.length; index += 1) {
          const level = levels[index - offset] ?? 0;
          (bars[index] as HTMLElement).style.height = `${Math.round(
            BAR_MIN_PX + Math.min(1, level) * (BAR_MAX_PX - BAR_MIN_PX),
          )}px`;
        }
      }),
    [syncLimitBytes],
  );

  return (
    <>
      <span
        ref={timeRef}
        role="timer"
        className="w-11 shrink-0 font-mono text-sm tabular-nums data-[near=true]:text-amber-700 dark:data-[near=true]:text-amber-400"
      >
        0:00
      </span>
      <span
        ref={sizeRef}
        hidden
        className="shrink-0 text-ui-sm whitespace-nowrap text-amber-700 dark:text-amber-400"
      />
      <div
        ref={waveRef}
        aria-hidden="true"
        className="flex h-7 min-w-0 flex-1 items-center justify-end gap-0.5 overflow-hidden"
      >
        {Array.from({ length: WAVE_BARS }, (_, index) => (
          <div
            key={index}
            className={cn(
              "w-[3px] shrink-0 rounded-sm",
              paused ? "bg-muted-foreground/40" : "bg-muted-foreground",
            )}
            style={{ height: BAR_MIN_PX }}
          />
        ))}
      </div>
    </>
  );
}

/** Switches the microphone for this recording only. */
function InputButton() {
  const deviceId = useVoiceNoteStore((s) => s.deviceId);
  const deviceLabel = useVoiceNoteStore((s) => s.deviceLabel);
  const [inputs, setInputs] = React.useState<MediaDeviceInfo[]>([]);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void listMicrophones().then(setInputs);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-0.5 px-1.5"
          aria-label={`Microphone: ${deviceLabel}`}
        >
          <Mic />
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={deviceId ?? ""}
          onValueChange={(next) => void switchVoiceNoteInput(next)}
        >
          {inputs.map((input) => (
            <DropdownMenuRadioItem key={input.deviceId} value={input.deviceId}>
              {input.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ProblemRow({ problem }: { problem: VoiceNoteProblem }) {
  const [hasSettings, setHasSettings] = React.useState(false);
  React.useEffect(() => {
    if (problem !== "access-off") return;
    void microphoneSettingsAvailable()
      .then(setHasSettings)
      .catch(() => setHasSettings(false));
  }, [problem]);

  const opensSettings = problem === "access-off" && hasSettings;
  return (
    <>
      <CircleAlert className="size-icon shrink-0 text-orange-700 dark:text-orange-400" />
      <span role="status" className="min-w-0 flex-1 text-ui">
        {PROBLEM_TEXT[problem]}
      </span>
      {opensSettings ? (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openMicrophoneSettings()}
        >
          Open system settings
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => void retryVoiceNote()}>
          Try again
        </Button>
      )}
      <Button variant="ghost" size="sm" onClick={discard}>
        Discard
      </Button>
    </>
  );
}

/** The recording, in the spot where its clip will go. */
export function VoiceRecordingElement(props: PlateElementProps) {
  const phase = useVoiceNoteStore((s) => s.phase);
  const problem = useVoiceNoteStore((s) => s.problem);
  const boxRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    registerVoiceNoteFocus(() => {
      boxRef.current?.scrollIntoView({ block: "nearest" });
      boxRef.current?.focus();
    });
    return () => registerVoiceNoteFocus(null);
  }, []);

  const recording = phase === "recording";
  const paused = phase === "paused";
  const running = recording || paused || phase === "saving";

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!running) return;
    if (event.target instanceof HTMLElement && event.target.closest("[role=menu]")) {
      return;
    }
    // The editor's own keys don't reach this block.
    const shortcut = findShortcut(
      event.nativeEvent,
      "editor",
      useSettingsStore.getState().shortcuts,
    );
    if (shortcut?.id === "voiceNote") {
      event.preventDefault();
      void save();
    } else if (event.key === " ") {
      event.preventDefault();
      if (recording) pauseVoiceNote();
      else void resumeVoiceNote();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      discard();
    }
  };

  return (
    <PlateElement {...props} className="my-1 mb-4">
      <div
        ref={boxRef}
        tabIndex={-1}
        contentEditable={false}
        role="group"
        aria-label="Voice note recording"
        className={boxClass}
        onKeyDown={onKeyDown}
      >
        {phase === "problem" && problem ? (
          <ProblemRow problem={problem} />
        ) : phase === "waiting" || phase === null ? (
          <>
            <div className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40" />
            <span role="status" className="min-w-0 flex-1 text-ui">
              Waiting for microphone access
            </span>
            <Button variant="ghost" size="sm" onClick={discard}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <div
              className={cn(
                "size-2.5 shrink-0 rounded-full",
                recording ? "bg-red-600" : "bg-muted-foreground/60",
              )}
            />
            <span role="status" className="sr-only">
              {recording ? "Recording" : "Paused"}
            </span>
            <Meter paused={!recording} />
            <InputButton />
            {recording ? (
              <Button variant="ghost" size="sm" onClick={pauseVoiceNote}>
                <Pause />
                Pause
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                disabled={!paused}
                onClick={() => void resumeVoiceNote()}
              >
                <Mic />
                Resume
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={discard}>
              <Trash2 />
              Discard
            </Button>
            <Button size="sm" disabled={!running} onClick={() => void save()}>
              <Check />
              Save
            </Button>
          </>
        )}
      </div>
      {props.children}
    </PlateElement>
  );
}
