/**
 * A small WebM writer for Opus audio, and a fix for the WebM files the
 * webview's own recorder makes.
 *
 * WebM is Matroska: elements of an ID, a size and a body. The writer streams
 * a file in clusters as audio arrives, then rewrites the head once the
 * length is known: the segment's size, a SeekHead to the cues, and the
 * duration. The new head is the same length as the first, so only those
 * bytes of the file change.
 */

// Element IDs, from the Matroska specification.
const ID = {
  ebml: [0x1a, 0x45, 0xdf, 0xa3],
  ebmlVersion: [0x42, 0x86],
  ebmlReadVersion: [0x42, 0xf7],
  ebmlMaxIdLength: [0x42, 0xf2],
  ebmlMaxSizeLength: [0x42, 0xf3],
  docType: [0x42, 0x82],
  docTypeVersion: [0x42, 0x87],
  docTypeReadVersion: [0x42, 0x85],
  segment: [0x18, 0x53, 0x80, 0x67],
  seekHead: [0x11, 0x4d, 0x9b, 0x74],
  seek: [0x4d, 0xbb],
  seekId: [0x53, 0xab],
  seekPosition: [0x53, 0xac],
  void: [0xec],
  info: [0x15, 0x49, 0xa9, 0x66],
  timecodeScale: [0x2a, 0xd7, 0xb1],
  duration: [0x44, 0x89],
  muxingApp: [0x4d, 0x80],
  writingApp: [0x57, 0x41],
  tracks: [0x16, 0x54, 0xae, 0x6b],
  trackEntry: [0xae],
  trackNumber: [0xd7],
  trackUid: [0x73, 0xc5],
  trackType: [0x83],
  codecId: [0x86],
  codecPrivate: [0x63, 0xa2],
  codecDelay: [0x56, 0xaa],
  seekPreRoll: [0x56, 0xbb],
  audio: [0xe1],
  samplingFrequency: [0xb5],
  channels: [0x9f],
  cluster: [0x1f, 0x43, 0xb6, 0x75],
  timecode: [0xe7],
  simpleBlock: [0xa3],
  cues: [0x1c, 0x53, 0xbb, 0x6b],
  cuePoint: [0xbb],
  cueTime: [0xb3],
  cueTrackPositions: [0xb7],
  cueTrack: [0xf7],
  cueClusterPosition: [0xf1],
} as const;

/** Timestamps count in milliseconds: the scale is in nanoseconds. */
const NANOSECONDS_PER_TICK = 1_000_000;
const AUDIO_TRACK_TYPE = 2;
const TRACK_NUMBER = 1;
/** A SimpleBlock flag: every Opus packet can be decoded on its own. */
const KEYFRAME_FLAG = 0x80;
/** Opus asks players to decode 80 ms before a seek target. */
const OPUS_SEEK_PRE_ROLL_NS = 80_000_000;
/** Opus always decodes at 48 kHz. */
export const OPUS_SAMPLE_RATE = 48_000;
/** A size field written as 8 bytes, so it can be filled in later. */
const LONG_SIZE_LENGTH = 8;
/** A position field written as 8 bytes, for the same reason. */
const LONG_UINT_LENGTH = 8;
/** "Unknown size": a streamed segment, before its end is written. */
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
/** A cluster's blocks give their time as a signed 16-bit offset from it. */
const MAX_BLOCK_OFFSET_MS = 0x7fff;
const APP_NAME = "Netherstone";

type Bytes = Uint8Array;

function concat(parts: readonly (Bytes | readonly number[])[]): Bytes {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** A size as an EBML variable-length integer, as short as it fits. */
function vint(value: number, length?: number): Bytes {
  let size = length ?? 1;
  if (length === undefined) {
    while (value >= 2 ** (7 * size) - 1) size += 1;
  }
  const out = new Uint8Array(size);
  let rest = value;
  for (let i = size - 1; i >= 0; i -= 1) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  out[0] |= 1 << (8 - size);
  return out;
}

function uintBytes(value: number, length?: number): Bytes {
  let size = length ?? 1;
  if (length === undefined) {
    while (value >= 2 ** (8 * size)) size += 1;
  }
  const out = new Uint8Array(size);
  let rest = value;
  for (let i = size - 1; i >= 0; i -= 1) {
    out[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return out;
}

function float64(value: number): Bytes {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setFloat64(0, value);
  return out;
}

function element(id: readonly number[], body: Bytes): Bytes {
  return concat([id, vint(body.length), body]);
}

const uint = (id: readonly number[], value: number, length?: number) =>
  element(id, uintBytes(value, length));
const text = (id: readonly number[], value: string) =>
  element(id, new TextEncoder().encode(value));

/** The OpusHead a WebM track carries when the encoder gives none. */
export function opusHead(channels: number, preSkip: number): Bytes {
  const out = new Uint8Array(19);
  out.set(new TextEncoder().encode("OpusHead"));
  const view = new DataView(out.buffer);
  view.setUint8(8, 1); // version
  view.setUint8(9, channels);
  view.setUint16(10, preSkip, true);
  view.setUint32(12, OPUS_SAMPLE_RATE, true);
  return out; // output gain 0, channel mapping 0
}

/** The pre-skip an OpusHead gives, in samples at 48 kHz. */
function preSkipOf(head: Bytes): number {
  return new DataView(head.buffer, head.byteOffset).getUint16(10, true);
}

function ebmlHeader(): Bytes {
  return element(
    ID.ebml,
    concat([
      uint(ID.ebmlVersion, 1),
      uint(ID.ebmlReadVersion, 1),
      uint(ID.ebmlMaxIdLength, 4),
      uint(ID.ebmlMaxSizeLength, 8),
      text(ID.docType, "webm"),
      uint(ID.docTypeVersion, 4),
      uint(ID.docTypeReadVersion, 2),
    ]),
  );
}

function seekEntry(id: readonly number[], position: number): Bytes {
  return element(
    ID.seek,
    concat([
      element(ID.seekId, Uint8Array.from(id)),
      uint(ID.seekPosition, position, LONG_UINT_LENGTH),
    ]),
  );
}

/** A Void element filling exactly `length` bytes. */
function voidOf(length: number): Bytes {
  // A one-byte ID and an 8-byte size leave the rest as body.
  const body = length - ID.void.length - LONG_SIZE_LENGTH;
  return concat([ID.void, vint(body, LONG_SIZE_LENGTH), new Uint8Array(body)]);
}

type HeadParts = {
  seekHead: Bytes;
  durationMs: number;
};

export type WebmWriterOptions = {
  channels: number;
  /** The encoder's OpusHead, or one made with `opusHead`. */
  codecPrivate: Bytes;
};

/**
 * Streams one Opus track as WebM. Feed it packets with `add`; it hands
 * back whole clusters to write. `finish` gives the last cluster with the
 * cues, and the head to write over the file's first bytes.
 */
export class WebmWriter {
  private readonly options: WebmWriterOptions;
  private readonly seekHeadLength: number;
  /** Bytes written into the segment so far. */
  private segmentLength = 0;
  private infoOffset = 0;
  private tracksOffset = 0;
  private cluster: { startMs: number; blocks: Bytes[] } | null = null;
  private readonly cuePoints: { timeMs: number; position: number }[] = [];
  private lastEndMs = 0;
  readonly head: Bytes;

  constructor(options: WebmWriterOptions) {
    this.options = options;
    const placeholder = this.seekHeadFor(0, 0, 0);
    this.seekHeadLength = placeholder.length;
    const ebml = ebmlHeader();
    const segmentHead = concat([ID.segment, UNKNOWN_SIZE]);
    const body = this.segmentBody({
      seekHead: voidOf(this.seekHeadLength),
      durationMs: 0,
    });
    this.segmentLength = body.length;
    this.head = concat([ebml, segmentHead, body]);
  }

  private seekHeadFor(info: number, tracks: number, cues: number): Bytes {
    return element(
      ID.seekHead,
      concat([
        seekEntry(ID.info, info),
        seekEntry(ID.tracks, tracks),
        seekEntry(ID.cues, cues),
      ]),
    );
  }

  private segmentBody({ seekHead, durationMs }: HeadParts): Bytes {
    const { channels, codecPrivate } = this.options;
    const info = element(
      ID.info,
      concat([
        uint(ID.timecodeScale, NANOSECONDS_PER_TICK),
        text(ID.muxingApp, APP_NAME),
        text(ID.writingApp, APP_NAME),
        element(ID.duration, float64(durationMs)),
      ]),
    );
    const preSkipNs = Math.round(
      (preSkipOf(codecPrivate) / OPUS_SAMPLE_RATE) * 1e9,
    );
    const tracks = element(
      ID.tracks,
      element(
        ID.trackEntry,
        concat([
          uint(ID.trackNumber, TRACK_NUMBER),
          uint(ID.trackUid, TRACK_NUMBER),
          uint(ID.trackType, AUDIO_TRACK_TYPE),
          text(ID.codecId, "A_OPUS"),
          element(ID.codecPrivate, codecPrivate),
          uint(ID.codecDelay, preSkipNs),
          uint(ID.seekPreRoll, OPUS_SEEK_PRE_ROLL_NS),
          element(
            ID.audio,
            concat([
              element(ID.samplingFrequency, float64(OPUS_SAMPLE_RATE)),
              uint(ID.channels, channels),
            ]),
          ),
        ]),
      ),
    );
    this.infoOffset = seekHead.length;
    this.tracksOffset = seekHead.length + info.length;
    return concat([seekHead, info, tracks]);
  }

  /**
   * Adds one packet starting at `timeMs`, lasting `durationMs`. Returns a
   * finished cluster to write, when this packet starts a new one.
   */
  add(packet: Bytes, timeMs: number, durationMs: number, clusterMs: number): Bytes | null {
    let finished: Bytes | null = null;
    const time = Math.round(timeMs);
    if (
      this.cluster &&
      (time - this.cluster.startMs >= clusterMs ||
        time - this.cluster.startMs > MAX_BLOCK_OFFSET_MS)
    ) {
      finished = this.closeCluster();
    }
    if (!this.cluster) this.cluster = { startMs: time, blocks: [] };
    const offset = time - this.cluster.startMs;
    const header = new Uint8Array(4);
    header[0] = 0x80 | TRACK_NUMBER;
    new DataView(header.buffer).setInt16(1, offset);
    header[3] = KEYFRAME_FLAG;
    this.cluster.blocks.push(element(ID.simpleBlock, concat([header, packet])));
    this.lastEndMs = Math.max(this.lastEndMs, timeMs + durationMs);
    return finished;
  }

  private closeCluster(): Bytes | null {
    const cluster = this.cluster;
    this.cluster = null;
    if (!cluster) return null;
    this.cuePoints.push({ timeMs: cluster.startMs, position: this.segmentLength });
    const bytes = element(
      ID.cluster,
      concat([uint(ID.timecode, cluster.startMs), ...cluster.blocks]),
    );
    this.segmentLength += bytes.length;
    return bytes;
  }

  /** The length so far, in milliseconds. */
  get durationMs(): number {
    return this.lastEndMs;
  }

  /**
   * Closes the file: the bytes to append (the last cluster and the cues),
   * and the head to write over the file's first `head.length` bytes.
   */
  finish(): { tail: Bytes; head: Bytes } {
    const last = this.closeCluster() ?? new Uint8Array();
    const cuesPosition = this.segmentLength;
    const cues = element(
      ID.cues,
      concat(
        this.cuePoints.map(({ timeMs, position }) =>
          element(
            ID.cuePoint,
            concat([
              uint(ID.cueTime, timeMs),
              element(
                ID.cueTrackPositions,
                concat([
                  uint(ID.cueTrack, TRACK_NUMBER),
                  uint(ID.cueClusterPosition, position),
                ]),
              ),
            ]),
          ),
        ),
      ),
    );
    this.segmentLength += cues.length;
    const seekHead = this.seekHeadFor(
      this.infoOffset,
      this.tracksOffset,
      cuesPosition,
    );
    const body = this.segmentBody({
      seekHead,
      durationMs: this.lastEndMs,
    });
    const head = concat([
      ebmlHeader(),
      ID.segment,
      vint(this.segmentLength, LONG_SIZE_LENGTH),
      body,
    ]);
    return { tail: concat([last, cues]), head };
  }
}

// ── Reading, for the recorder's own files ─────────────────────────────────

type Read = { id: number[]; size: number | null; start: number; end: number };

function readVint(bytes: Bytes, at: number): { value: number | null; length: number } {
  const first = bytes[at];
  if (first === undefined || first === 0) return { value: null, length: 1 };
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length += 1;
  let value = first & (0xff >> length);
  let allOnes = value === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    const byte = bytes[at + i] ?? 0;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value: allOnes ? null : value, length };
}

function readId(bytes: Bytes, at: number): number[] {
  const first = bytes[at] ?? 0;
  let length = 1;
  while (length < 4 && !(first & (0x80 >> (length - 1)))) length += 1;
  return Array.from(bytes.subarray(at, at + length));
}

function readElement(bytes: Bytes, at: number): Read | null {
  if (at >= bytes.length) return null;
  const id = readId(bytes, at);
  const size = readVint(bytes, at + id.length);
  const start = at + id.length + size.length;
  return {
    id,
    size: size.value,
    start,
    end: size.value === null ? bytes.length : start + size.value,
  };
}

const sameId = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * The duration a WebM file's head gives, in milliseconds, or null when it
 * has none. Reads only the head, so a player can show the length of a clip
 * from its first bytes.
 */
export function readWebmDurationMs(bytes: Bytes): number | null {
  const ebml = readElement(bytes, 0);
  if (!ebml || !sameId(ebml.id, ID.ebml)) return null;
  const segment = readElement(bytes, ebml.end);
  if (!segment || !sameId(segment.id, ID.segment)) return null;
  let at = segment.start;
  while (at < bytes.length) {
    const child = readElement(bytes, at);
    if (!child || child.size === null) return null;
    if (sameId(child.id, ID.info)) {
      let scale = NANOSECONDS_PER_TICK;
      let duration: number | null = null;
      let inner = child.start;
      while (inner < Math.min(child.end, bytes.length)) {
        const field = readElement(bytes, inner);
        if (!field || field.size === null) break;
        const body = bytes.subarray(field.start, field.end);
        const view = new DataView(body.buffer, body.byteOffset, body.length);
        if (sameId(field.id, ID.timecodeScale)) {
          scale = body.reduce((value, byte) => value * 256 + byte, 0);
        } else if (sameId(field.id, ID.duration)) {
          duration = body.length === 4 ? view.getFloat32(0) : view.getFloat64(0);
        }
        inner = field.end;
      }
      return duration === null || duration <= 0
        ? null
        : (duration * scale) / NANOSECONDS_PER_TICK;
    }
    if (sameId(child.id, ID.cluster)) return null;
    at = child.end;
  }
  return null;
}

/**
 * A new head for a WebM file the webview's recorder made, which leaves out
 * the duration: the bytes up to the end of its Info, with the duration
 * added. Null when the head isn't one this can read.
 */
export function withWebmDuration(
  firstBytes: Bytes,
  durationMs: number,
): { head: Bytes; replaces: number } | null {
  const ebml = readElement(firstBytes, 0);
  if (!ebml || !sameId(ebml.id, ID.ebml)) return null;
  const segment = readElement(firstBytes, ebml.end);
  if (!segment || !sameId(segment.id, ID.segment)) return null;
  let at = segment.start;
  while (at < firstBytes.length) {
    const child = readElement(firstBytes, at);
    if (!child || child.size === null || child.end > firstBytes.length) {
      return null;
    }
    if (sameId(child.id, ID.info)) {
      let scale = NANOSECONDS_PER_TICK;
      const kept: Bytes[] = [];
      let inner = child.start;
      while (inner < child.end) {
        const field = readElement(firstBytes, inner);
        if (!field || field.size === null) return null;
        const whole = firstBytes.subarray(inner, field.end);
        if (sameId(field.id, ID.timecodeScale)) {
          scale = firstBytes
            .subarray(field.start, field.end)
            .reduce((value, byte) => value * 256 + byte, 0);
        }
        if (!sameId(field.id, ID.duration)) kept.push(whole);
        inner = field.end;
      }
      const ticks = (durationMs * NANOSECONDS_PER_TICK) / scale;
      const info = element(
        ID.info,
        concat([...kept, element(ID.duration, float64(ticks))]),
      );
      return {
        head: concat([firstBytes.subarray(0, at), info]),
        replaces: child.end,
      };
    }
    at = child.end;
  }
  return null;
}
