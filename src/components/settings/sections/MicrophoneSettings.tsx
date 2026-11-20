import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, Mic, Play } from "lucide-react";

import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  microphoneSettingsAvailable,
  openMicrophoneSettings,
} from "@/lib/commands/voice-notes";
import {
  listMicrophones,
  MicrophoneError,
  openMicrophone,
  releaseMicrophone,
} from "@/lib/voice/capture";
import { useSettingsStore } from "@/store/settings";

const SEGMENTS = 28;
/** The last segments, lit only by sound close to clipping. */
const LOUD_SEGMENTS = 4;
/** The quietest sound the meter shows, in decibels. */
const FLOOR_DB = -60;
const METER_MS = 100;
const TEST_SECONDS = 5;
const SECOND_MS = 1000;
const SYSTEM_DEFAULT = "default";

type Test =
  | { step: "idle"; recorded: string | null }
  | { step: "recording" | "playing"; left: number; recorded: string | null };

function litSegments(peak: number): number {
  if (peak <= 0) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(SEGMENTS, Math.round(((db - FLOOR_DB) / -FLOOR_DB) * SEGMENTS)));
}

/** Whether this page may use the microphone without the system asking. */
async function accessGiven(): Promise<boolean> {
  const devices = await listMicrophones().catch(() => []);
  return devices.some((device) => device.label !== "");
}

/** Lights the meter from `stream` about ten times a second, without renders. */
function useLevelMeter(stream: MediaStream | null) {
  const meterRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const segments = meterRef.current?.children;
    const draw = (lit: number) => {
      if (!segments) return;
      for (let index = 0; index < segments.length; index += 1) {
        (segments[index] as HTMLElement).dataset.lit = String(index < lit);
      }
    };
    if (!stream) {
      draw(0);
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    context.createMediaStreamSource(stream).connect(analyser);
    void context.resume();
    const samples = new Float32Array(analyser.fftSize);
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      draw(litSegments(peak));
    }, METER_MS);
    return () => {
      window.clearInterval(timer);
      void context.close();
      draw(0);
    };
  }, [stream]);
  return meterRef;
}

export function MicrophoneSettings() {
  const inputId = useId();
  const microphone = useSettingsStore((s) => s.microphone);
  const setPreference = useSettingsStore((s) => s.setPreference);
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [accessOff, setAccessOff] = useState(false);
  const [hasSystemPage, setHasSystemPage] = useState(false);
  const [test, setTest] = useState<Test>({ step: "idle", recorded: null });
  const meterRef = useLevelMeter(stream);
  const streamRef = useRef<MediaStream | null>(null);
  const playerRef = useRef<HTMLAudioElement | null>(null);

  const chosen = inputs.find((input) => input.deviceId === microphone?.deviceId);
  const defaultInput =
    inputs.find((input) => input.deviceId === SYSTEM_DEFAULT) ?? inputs[0];

  const open = async (): Promise<MediaStream | null> => {
    try {
      const next = await openMicrophone(microphone?.deviceId);
      releaseMicrophone(streamRef.current);
      streamRef.current = next;
      setStream(next);
      setAccessOff(false);
      setInputs(await listMicrophones());
      return next;
    } catch (error) {
      if (error instanceof MicrophoneError && error.problem === "access-off") {
        setAccessOff(true);
      }
      return null;
    }
  };

  // The meter is live while this page is open, once access was given.
  useEffect(() => {
    let left = false;
    void microphoneSettingsAvailable()
      .then(setHasSystemPage)
      .catch(() => setHasSystemPage(false));
    void listMicrophones().then((found) => !left && setInputs(found));
    void accessGiven().then((given) => {
      if (given && !left) void open();
    });
    return () => {
      left = true;
      releaseMicrophone(streamRef.current);
      streamRef.current = null;
      playerRef.current?.pause();
    };
    // Opens once; a new input reopens below.
  }, []);

  useEffect(() => {
    if (streamRef.current) void open();
  }, [microphone?.deviceId]);

  useEffect(
    () => () => {
      if (test.recorded) URL.revokeObjectURL(test.recorded);
    },
    [test.recorded],
  );

  const countDown = (step: "recording" | "playing", recorded: string | null) => {
    setTest({ step, left: TEST_SECONDS, recorded });
    const timer = window.setInterval(() => {
      setTest((current) =>
        current.step === step && current.left > 1
          ? { ...current, left: current.left - 1 }
          : current,
      );
    }, SECOND_MS);
    return () => window.clearInterval(timer);
  };

  const play = (recorded: string) => {
    const stop = countDown("playing", recorded);
    const player = new Audio(recorded);
    playerRef.current = player;
    const done = () => {
      stop();
      setTest({ step: "idle", recorded });
    };
    player.onended = done;
    player.onerror = done;
    void player.play().catch(done);
  };

  const recordTest = async () => {
    const source = streamRef.current ?? (await open());
    if (!source) return;
    const recorder = new MediaRecorder(source);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stop = countDown("recording", null);
    recorder.onstop = () => {
      stop();
      play(URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType })));
    };
    recorder.start();
    window.setTimeout(() => recorder.stop(), TEST_SECONDS * SECOND_MS);
  };

  const status =
    test.step === "recording"
      ? `Recording 0:${String(test.left).padStart(2, "0")}`
      : test.step === "playing"
        ? `Playing 0:${String(test.left).padStart(2, "0")}`
        : null;

  return (
    <>
      {accessOff && (
        <SettingsGroup bare>
          <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 shadow-xs">
            <CircleAlert className="size-icon shrink-0 text-orange-700 dark:text-orange-400" />
            <span role="status" className="min-w-0 flex-1 text-ui">
              Microphone access is off for Netherstone
            </span>
            {hasSystemPage && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openMicrophoneSettings()}
              >
                Open system settings
              </Button>
            )}
          </div>
        </SettingsGroup>
      )}
      <SettingsGroup>
        <SettingRow label="Input" htmlFor={inputId}>
          <Select
            value={chosen?.deviceId ?? SYSTEM_DEFAULT}
            onValueChange={(next) => {
              const input = inputs.find((item) => item.deviceId === next);
              setPreference(
                "microphone",
                next === SYSTEM_DEFAULT || !input
                  ? null
                  : { deviceId: input.deviceId, label: input.label },
              );
            }}
          >
            <SelectTrigger id={inputId} size="sm" className="min-w-36 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" align="end">
              <SelectItem value={SYSTEM_DEFAULT}>
                {defaultInput?.label
                  ? `System default (${defaultInput.label.replace(/^Default - /, "")})`
                  : "System default"}
              </SelectItem>
              {inputs
                .filter((input) => input.deviceId !== SYSTEM_DEFAULT)
                .map((input) => (
                  <SelectItem key={input.deviceId} value={input.deviceId}>
                    {input.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </SettingRow>
        <SettingRow label="Level">
          <div
            ref={meterRef}
            role="meter"
            aria-label="Input level"
            className="flex h-4 items-center gap-[3px]"
          >
            {Array.from({ length: SEGMENTS }, (_, index) => (
              <div
                key={index}
                data-lit="false"
                className={
                  index >= SEGMENTS - LOUD_SEGMENTS
                    ? "h-3.5 w-1.5 rounded-xs bg-muted data-[lit=true]:bg-orange-700 dark:data-[lit=true]:bg-orange-400"
                    : "h-3.5 w-1.5 rounded-xs bg-muted data-[lit=true]:bg-ring"
                }
              />
            ))}
          </div>
        </SettingRow>
        <SettingRow label="Test">
          <div className="flex items-center gap-3">
            {status && (
              <span role="status" className="font-mono text-[13px] text-muted-foreground tabular-nums">
                {status}
              </span>
            )}
            {test.step === "idle" && test.recorded && (
              <Button variant="outline" size="sm" onClick={() => play(test.recorded!)}>
                <Play className="size-3 fill-current stroke-none" />
                Play again
              </Button>
            )}
            {test.step === "idle" && (
              <Button variant="outline" size="sm" onClick={() => void recordTest()}>
                <Mic />
                Record a test
              </Button>
            )}
          </div>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}
