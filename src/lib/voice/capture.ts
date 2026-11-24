/**
 * Records the microphone as WebM with Opus, mono, at about 32 kbit/s.
 *
 * Where the webview has an Opus encoder (WebCodecs), the app encodes the
 * sound itself and writes the WebM file, so every recording has the same
 * layout, a duration and cues. Elsewhere (older macOS) the webview's own
 * recorder makes the WebM file, and the duration is added at the end.
 * Linux's webview can't make WebM with its own recorder at all.
 */

import workletUrl from "./capture-worklet.js?url&no-inline";
import {
  opusHead,
  OPUS_SAMPLE_RATE,
  WebmWriter,
  withWebmDuration,
} from "./webm";

/** Close to "about 32 kbit/s", which keeps 20 MB at over an hour. */
const BITS_PER_SECOND = 32_000;
/** Samples per block sent from the audio thread: 100 ms, so the level and
 * timer move about ten times a second. */
const BLOCK_FRAMES = OPUS_SAMPLE_RATE / 10;
/** Each WebM cluster holds about a second, so each write is small. */
const CLUSTER_MS = 1000;
/** The start of a recorder's file kept to add its duration: the EBML
 * header, Info and Tracks take a few hundred bytes. */
const RECORDER_HEAD_BYTES = 4096;
/** How often the webview's own recorder hands over what it has. */
const RECORDER_SLICE_MS = 1000;
/** Samples libopus holds back at the start, for files whose encoder gives
 * no OpusHead of its own. */
const OPUS_PRE_SKIP = 312;
const WEBM_OPUS = "audio/webm;codecs=opus";
const ENCODER_CONFIG = {
  codec: "opus",
  sampleRate: OPUS_SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: BITS_PER_SECOND,
} as const;

export type MicrophoneProblem = "access-off" | "no-microphone" | "failed";

/** Why the microphone couldn't be opened. */
export class MicrophoneError extends Error {
  readonly problem: MicrophoneProblem;
  constructor(problem: MicrophoneProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

function problemOf(error: unknown): MicrophoneProblem {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "access-off";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "no-microphone";
  }
  return "failed";
}

/**
 * Opens the microphone `deviceId`, or the system's default one. A device
 * that's gone falls back to the default.
 */
export async function openMicrophone(deviceId?: string): Promise<MediaStream> {
  const ask = (audio: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia({ audio });
  const base: MediaTrackConstraints = { channelCount: 1 };
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneError("no-microphone", "No microphone API.");
  }
  try {
    return await ask(deviceId ? { ...base, deviceId: { exact: deviceId } } : base);
  } catch (error) {
    if (deviceId && problemOf(error) === "no-microphone") {
      try {
        return await ask(base);
      } catch (fallbackError) {
        throw new MicrophoneError(problemOf(fallbackError), String(fallbackError));
      }
    }
    throw new MicrophoneError(problemOf(error), String(error));
  }
}

/** The microphones this computer has. Names show once access was given. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter(
    (device) => device.kind === "audioinput" && device.deviceId !== "",
  );
}

export type CaptureEvents = {
  /** About ten times a second: the loudest sample of the last block, 0 to 1. */
  onLevel?: (peak: number) => void;
  /** Bytes of the file, in order, as they're made. */
  onBytes: (bytes: Uint8Array) => void;
  /** The microphone went away, such as a headset unplugged. */
  onDeviceLost?: () => void;
};

/** How the file's head changes once the recording ends. */
export type FinishedHead = { head: Uint8Array; replaces: number };

type Engine = {
  pause(): void;
  resume(): void;
  durationMs(): number;
  finish(): Promise<FinishedHead | null>;
};

async function canEncodeOpus(): Promise<boolean> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    return false;
  }
  try {
    const support = await AudioEncoder.isConfigSupported(ENCODER_CONFIG);
    return support.supported === true;
  } catch {
    return false;
  }
}

/** Encodes blocks with WebCodecs and writes the WebM file itself. */
function encoderEngine(
  events: CaptureEvents,
): Engine & { take(samples: Float32Array): void } {
  let writer: WebmWriter | null = null;
  let frames = 0;
  let paused = false;
  // Set once the recording is finishing: blocks the audio thread still
  // sends after that would reach a closed encoder.
  let finishing = false;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const packet = new Uint8Array(chunk.byteLength);
      chunk.copyTo(packet);
      if (!writer) {
        const description = metadata?.decoderConfig?.description;
        const codecPrivate =
          description instanceof ArrayBuffer
            ? new Uint8Array(description)
            : ArrayBuffer.isView(description)
              ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
              : opusHead(1, OPUS_PRE_SKIP);
        writer = new WebmWriter({ channels: 1, codecPrivate });
        events.onBytes(writer.head);
      }
      const cluster = writer.add(
        packet,
        chunk.timestamp / 1000,
        (chunk.duration ?? 0) / 1000,
        CLUSTER_MS,
      );
      if (cluster) events.onBytes(cluster);
    },
    error: (error) => console.error("[voice-notes] Encoder failed", error),
  });
  encoder.configure(ENCODER_CONFIG);

  return {
    take(samples) {
      if (paused || finishing) return;
      const data = new AudioData({
        format: "f32",
        sampleRate: OPUS_SAMPLE_RATE,
        numberOfFrames: samples.length,
        numberOfChannels: 1,
        timestamp: Math.round((frames / OPUS_SAMPLE_RATE) * 1e6),
        data: samples,
      });
      frames += samples.length;
      encoder.encode(data);
      data.close();
    },
    pause: () => (paused = true),
    resume: () => (paused = false),
    durationMs: () => (frames / OPUS_SAMPLE_RATE) * 1000,
    async finish() {
      finishing = true;
      await encoder.flush();
      encoder.close();
      if (!writer) return null;
      const { tail, head } = writer.finish();
      if (tail.length) events.onBytes(tail);
      return { head, replaces: head.length };
    },
  };
}

/**
 * The webview's own recorder, adding the duration once it stops. It records
 * the audio graph's output, so the microphone can change mid-recording.
 */
function recorderEngine(
  stream: MediaStream,
  events: CaptureEvents,
): Engine & { count(frames: number): void } {
  const recorder = new MediaRecorder(stream, {
    mimeType: WEBM_OPUS,
    audioBitsPerSecond: BITS_PER_SECOND,
  });
  // The recorder hands over its head in small pieces; enough is kept to
  // reach past the Info, where the duration goes.
  let head = new Uint8Array();
  let pending = Promise.resolve();
  // Counted from the samples that reach it, not the clock, so a busy
  // audio thread can't make the length wrong.
  let frames = 0;
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    pending = pending.then(async () => {
      const bytes = new Uint8Array(await event.data.arrayBuffer());
      if (head.length < RECORDER_HEAD_BYTES) {
        const joined = new Uint8Array(head.length + bytes.length);
        joined.set(head);
        joined.set(bytes, head.length);
        head = joined;
      }
      events.onBytes(bytes);
    });
  };
  recorder.start(RECORDER_SLICE_MS);
  const durationMs = () => (frames / OPUS_SAMPLE_RATE) * 1000;

  return {
    count(more) {
      if (recorder.state === "recording") frames += more;
    },
    pause() {
      if (recorder.state === "recording") recorder.pause();
    },
    resume() {
      if (recorder.state === "paused") recorder.resume();
    },
    durationMs,
    async finish() {
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      if (recorder.state !== "inactive") recorder.stop();
      await stopped;
      await pending;
      return withWebmDuration(head, durationMs());
    },
  };
}

/**
 * One recording from `stream`. Streams stay the caller's: closing the
 * recording stops the audio graph, not the microphone.
 */
export class VoiceCapture {
  private readonly context: AudioContext;
  private readonly node: AudioWorkletNode;
  private readonly engine: Engine;
  private readonly onTrackEnded: () => void;
  private stream: MediaStream;
  private source: MediaStreamAudioSourceNode;
  private closed = false;

  private constructor(parts: {
    context: AudioContext;
    node: AudioWorkletNode;
    engine: Engine;
    stream: MediaStream;
    source: MediaStreamAudioSourceNode;
    onTrackEnded: () => void;
  }) {
    this.context = parts.context;
    this.node = parts.node;
    this.engine = parts.engine;
    this.stream = parts.stream;
    this.source = parts.source;
    this.onTrackEnded = parts.onTrackEnded;
    this.watch(this.stream);
  }

  private watch(stream: MediaStream) {
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", this.onTrackEnded);
    }
  }

  private unwatch(stream: MediaStream) {
    for (const track of stream.getAudioTracks()) {
      track.removeEventListener("ended", this.onTrackEnded);
    }
  }

  /**
   * Records from `stream` from now on, in the same file. The old stream
   * stays the caller's to release.
   */
  switchTo(stream: MediaStream) {
    this.unwatch(this.stream);
    this.source.disconnect();
    this.stream = stream;
    this.source = this.context.createMediaStreamSource(stream);
    this.source.connect(this.node);
    this.watch(stream);
  }

  static async start(
    stream: MediaStream,
    events: CaptureEvents,
  ): Promise<VoiceCapture> {
    const context = new AudioContext({ sampleRate: OPUS_SAMPLE_RATE });
    await context.audioWorklet.addModule(workletUrl);
    await context.resume();
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "voice-capture", {
      outputChannelCount: [1],
      processorOptions: { blockFrames: BLOCK_FRAMES },
    });
    // The graph only runs while it reaches the speakers; at no volume.
    const silent = context.createGain();
    silent.gain.value = 0;
    source.connect(node).connect(silent).connect(context.destination);
    // The webview's recorder takes the graph's sound, not the microphone's.
    const recorded = context.createMediaStreamDestination();
    recorded.channelCount = 1;
    node.connect(recorded);

    let engine: Engine;
    if (context.sampleRate === OPUS_SAMPLE_RATE && (await canEncodeOpus())) {
      const encoding = encoderEngine(events);
      node.port.onmessage = ({ data }) => {
        encoding.take(data.samples);
        events.onLevel?.(data.peak);
      };
      engine = encoding;
    } else if (
      typeof MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(WEBM_OPUS)
    ) {
      const recording = recorderEngine(recorded.stream, events);
      node.port.onmessage = ({ data }) => {
        recording.count(data.samples.length);
        events.onLevel?.(data.peak);
      };
      engine = recording;
    } else {
      await context.close();
      throw new MicrophoneError("failed", "No way to record WebM with Opus.");
    }

    return new VoiceCapture({
      context,
      node,
      engine,
      stream,
      source,
      onTrackEnded: () => events.onDeviceLost?.(),
    });
  }

  pause() {
    this.engine.pause();
  }

  resume() {
    this.engine.resume();
  }

  get durationMs(): number {
    return this.engine.durationMs();
  }

  /** Stops recording. The head to write over the file's first bytes. */
  async finish(): Promise<FinishedHead | null> {
    const head = await this.engine.finish();
    await this.close();
    return head;
  }

  /** Stops the audio graph, keeping nothing more. */
  async close() {
    if (this.closed) return;
    this.closed = true;
    this.unwatch(this.stream);
    await this.context.close().catch(() => {});
  }
}

/** Stops every track of `stream`, releasing the microphone. */
export function releaseMicrophone(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}
