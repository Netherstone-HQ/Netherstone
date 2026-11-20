import * as React from "react";

import { AudioLines, Ellipsis, Pause, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readWebmDurationMs } from "@/lib/voice/webm";
import { cn } from "@/lib/utils";

import { formatClock } from "./voice-recording-node";

const SPEEDS = [1, 1.5, 2] as const;
/** How far an arrow key moves the clip. */
const ARROW_STEP_SECONDS = 5;
/** Enough of a WebM file to reach its duration. */
const HEAD_BYTES = 4096;
const TICK_MS = 100;

/**
 * How a clip plays. Most play from their URL. Some webviews can't play the
 * app's file URLs (Linux) and play a copy in memory instead; some can't
 * play WebM in a media element at all (older macOS) and decode it to play
 * with Web Audio. Each step is only tried when the one before fails, and
 * nothing is fetched until Play.
 */
type Mode = "url" | "fallback" | "memory" | "decoded" | "cant-play";

type Decoded = {
  context: AudioContext;
  buffer: AudioBuffer;
  source: AudioBufferSourceNode | null;
  /** Context time at the clip's start, when playing. */
  startedAt: number;
  offset: number;
};

function extensionOf(url: string): string {
  const name = decodeURIComponent(url.split(/[?#]/)[0]).split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function useClipPlayer(url: string) {
  const audioRef = React.useRef<HTMLAudioElement>(null);
  const [mode, setMode] = React.useState<Mode>("url");
  const [playing, setPlaying] = React.useState(false);
  const [time, setTime] = React.useState(0);
  const [duration, setDuration] = React.useState(0);
  const [rate, setRate] = React.useState<number>(SPEEDS[0]);
  const decodedRef = React.useRef<Decoded | null>(null);
  const memoryUrlRef = React.useRef<string | null>(null);

  // The parent keys the player by URL, so a new clip starts fresh.
  React.useEffect(() => {
    return () => {
      if (memoryUrlRef.current) URL.revokeObjectURL(memoryUrlRef.current);
      memoryUrlRef.current = null;
      void decodedRef.current?.context.close();
      decodedRef.current = null;
    };
  }, [url]);

  const decodedTime = React.useCallback(() => {
    const decoded = decodedRef.current;
    if (!decoded) return 0;
    if (!decoded.source) return decoded.offset;
    return Math.min(
      decoded.buffer.duration,
      decoded.offset + (decoded.context.currentTime - decoded.startedAt) * rate,
    );
  }, [rate]);

  // Web Audio has no time events; the clock is read while it plays.
  React.useEffect(() => {
    if (mode !== "decoded" || !playing) return;
    const timer = window.setInterval(() => setTime(decodedTime()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [decodedTime, mode, playing]);

  // The URL failed to load: show the length from the file's head, if it
  // says, without playing anything.
  const onUrlError = React.useCallback(() => {
    // Play handles a copy in memory that fails.
    if (mode !== "url" || memoryUrlRef.current) return;
    setMode("fallback");
    if (extensionOf(url) !== "webm") return;
    void fetch(url, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } })
      .then((response) => response.arrayBuffer())
      .then((bytes) => {
        const ms = readWebmDurationMs(new Uint8Array(bytes));
        if (ms) setDuration(ms / 1000);
      })
      .catch(() => {});
  }, [mode, url]);

  // The file can fail before the player listens for it.
  React.useEffect(() => {
    if (audioRef.current?.error) onUrlError();
  }, [onUrlError]);

  const startDecoded = React.useCallback(
    (from: number) => {
      const decoded = decodedRef.current;
      if (!decoded) return;
      decoded.source?.stop();
      const source = decoded.context.createBufferSource();
      source.buffer = decoded.buffer;
      source.playbackRate.value = rate;
      source.connect(decoded.context.destination);
      source.onended = () => {
        if (decoded.source !== source) return;
        decoded.source = null;
        decoded.offset = 0;
        setPlaying(false);
        setTime(0);
      };
      decoded.source = source;
      decoded.offset = from;
      decoded.startedAt = decoded.context.currentTime;
      source.start(0, from);
      void decoded.context.resume();
      setPlaying(true);
    },
    [rate],
  );

  const stopDecoded = React.useCallback(() => {
    const decoded = decodedRef.current;
    if (!decoded?.source) return;
    const at = decodedTime();
    const source = decoded.source;
    decoded.source = null;
    source.stop();
    decoded.offset = at;
    setTime(at);
  }, [decodedTime]);

  const play = React.useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (mode === "decoded") {
      startDecoded(decodedRef.current?.offset ?? 0);
      return;
    }
    if (mode === "url" || mode === "memory") {
      await audio.play().catch(() => {});
      return;
    }
    if (mode !== "fallback") return;
    try {
      const bytes = await (await fetch(url)).arrayBuffer();
      memoryUrlRef.current = URL.createObjectURL(new Blob([bytes]));
      audio.src = memoryUrlRef.current;
      try {
        setMode("memory");
        await audio.play();
        return;
      } catch {
        // This webview can't play the format in a media element.
      }
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(bytes);
      decodedRef.current = { context, buffer, source: null, startedAt: 0, offset: 0 };
      setDuration(buffer.duration);
      setMode("decoded");
      startDecoded(0);
    } catch (error) {
      console.error("[audio-player] Couldn't play", error);
      setMode("cant-play");
    }
  }, [mode, rate, startDecoded, url]);

  const pause = React.useCallback(() => {
    if (mode === "decoded") {
      stopDecoded();
      setPlaying(false);
      return;
    }
    audioRef.current?.pause();
  }, [mode, stopDecoded]);

  const seek = React.useCallback(
    (to: number) => {
      const clamped = Math.max(0, Math.min(duration || 0, to));
      setTime(clamped);
      if (mode === "decoded") {
        const decoded = decodedRef.current;
        if (!decoded) return;
        if (decoded.source) startDecoded(clamped);
        else decoded.offset = clamped;
        return;
      }
      const audio = audioRef.current;
      if (audio && Number.isFinite(audio.duration)) audio.currentTime = clamped;
    },
    [duration, mode, startDecoded],
  );

  const cycleRate = React.useCallback(() => {
    const next = SPEEDS[(SPEEDS.indexOf(rate as (typeof SPEEDS)[number]) + 1) % SPEEDS.length];
    if (audioRef.current) audioRef.current.playbackRate = next;
    const decoded = decodedRef.current;
    if (decoded?.source) {
      // Keeps the place: the time so far ran at the old speed.
      decoded.offset = decodedTime();
      decoded.startedAt = decoded.context.currentTime;
      decoded.source.playbackRate.value = next;
    }
    setRate(next);
  }, [decodedTime, rate]);

  const audioProps = {
    ref: audioRef,
    src: url,
    preload: "metadata",
    onLoadedMetadata: (event: React.SyntheticEvent<HTMLAudioElement>) => {
      const value = event.currentTarget.duration;
      if (Number.isFinite(value)) setDuration(value);
      event.currentTarget.playbackRate = rate;
    },
    onDurationChange: (event: React.SyntheticEvent<HTMLAudioElement>) => {
      const value = event.currentTarget.duration;
      if (Number.isFinite(value)) setDuration(value);
    },
    onTimeUpdate: (event: React.SyntheticEvent<HTMLAudioElement>) =>
      setTime(event.currentTarget.currentTime),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onError: onUrlError,
  } as const;

  return { audioProps, mode, playing, time, duration, rate, play, pause, seek, cycleRate };
}

function SeekBar({
  time,
  duration,
  onSeek,
}: {
  time: number;
  duration: number;
  onSeek: (to: number) => void;
}) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const share = duration > 0 ? Math.min(1, time / duration) : 0;

  const seekToPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || duration <= 0) return;
    onSeek(((clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(time)}
      aria-valuetext={formatClock(time * 1000)}
      className="group/seek relative flex h-6 min-w-0 flex-1 cursor-pointer touch-none items-center rounded-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekToPointer(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          seekToPointer(event.clientX);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          event.preventDefault();
          onSeek(time + ARROW_STEP_SECONDS);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          event.preventDefault();
          onSeek(time - ARROW_STEP_SECONDS);
        } else if (event.key === "Home") {
          event.preventDefault();
          onSeek(0);
        } else if (event.key === "End") {
          event.preventDefault();
          onSeek(duration);
        }
      }}
    >
      <div className="relative h-1 w-full rounded-sm bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-sm bg-primary"
          style={{ width: `${share * 100}%` }}
        />
        <div
          className="absolute -top-1 size-3 rounded-full bg-primary"
          style={{ left: `calc(${share * 100}% - 6px)` }}
        />
      </div>
    </div>
  );
}

export const playerBoxClass =
  "flex h-14 items-center gap-3 rounded-xl border border-border bg-card px-2.5 text-card-foreground";

/** The app's own player for an audio block. */
export function AudioPlayer({
  url,
  onOpen,
  onRemove,
}: {
  url: string;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const player = useClipPlayer(url);

  if (player.mode === "cant-play") {
    return (
      <div className={cn(playerBoxClass, "pl-4")}>
        <AudioLines className="size-icon shrink-0 text-muted-foreground" />
        <span role="status" className="min-w-0 flex-1 text-ui">
          This computer can't play .{extensionOf(url)} files
        </span>
        {onOpen && (
          <Button variant="outline" size="sm" onClick={onOpen}>
            Open
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className={playerBoxClass} role="group" aria-label="Audio">
      <audio {...player.audioProps} hidden />
      <button
        type="button"
        aria-label={player.playing ? "Pause" : "Play"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-icon"
        onClick={() => (player.playing ? player.pause() : void player.play())}
      >
        {player.playing ? <Pause /> : <Play />}
      </button>
      <span className="shrink-0 font-mono text-sm text-muted-foreground tabular-nums">
        {formatClock(player.time * 1000)}
        {player.duration > 0 && ` / ${formatClock(player.duration * 1000)}`}
      </span>
      <SeekBar time={player.time} duration={player.duration} onSeek={player.seek} />
      <Button
        variant="outline"
        size="sm"
        className="font-mono text-[13px]"
        aria-label={`Speed ${player.rate}x`}
        onClick={player.cycleRate}
      >
        {player.rate}x
      </Button>
      {(onOpen || onRemove) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="px-2" aria-label="More">
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-45">
            {onOpen && <DropdownMenuItem onSelect={onOpen}>Open</DropdownMenuItem>}
            {onOpen && onRemove && <DropdownMenuSeparator />}
            {onRemove && (
              <DropdownMenuItem variant="destructive" onSelect={onRemove}>
                Remove
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
