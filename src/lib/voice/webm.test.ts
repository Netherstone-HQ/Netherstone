import { describe, expect, it } from "vitest";

import {
  opusHead,
  readWebmDurationMs,
  WebmWriter,
  withWebmDuration,
} from "./webm";

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const PACKET_MS = 20;
const CLUSTER_MS = 1000;

/** One EBML element with a payload under 127 bytes. */
const el = (id: number[], payload: number[]) => [...id, 0x80 | payload.length, ...payload];

/** The start of a file as a webview's recorder writes it: no duration. */
function recorderHead(): Uint8Array {
  const header = el(EBML_MAGIC, el([0x42, 0x82], [..."webm"].map((c) => c.charCodeAt(0))));
  const unknownSize = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
  const info = el([0x15, 0x49, 0xa9, 0x66], [
    ...el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]),
    ...el([0x4d, 0x80], [0x41]),
  ]);
  const tracks = el([0x16, 0x54, 0xae, 0x6b], el([0xae], el([0xd7], [1])));
  return new Uint8Array([...header, 0x18, 0x53, 0x80, 0x67, ...unknownSize, ...info, ...tracks]);
}

function record(seconds: number) {
  const writer = new WebmWriter({ channels: 1, codecPrivate: opusHead(1, 312) });
  const firstHead = writer.head;
  const clusters: Uint8Array[] = [];
  for (let time = 0; time < seconds * 1000; time += PACKET_MS) {
    const cluster = writer.add(new Uint8Array([1, 2, 3]), time, PACKET_MS, CLUSTER_MS);
    if (cluster) clusters.push(cluster);
  }
  return { writer, firstHead, clusters, ...writer.finish() };
}

describe("WebmWriter", () => {
  it("writes a WebM head and a cluster about every second", () => {
    const { firstHead, clusters } = record(3);
    expect(Array.from(firstHead.subarray(0, 4))).toEqual(EBML_MAGIC);
    expect(clusters).toHaveLength(2);
  });

  it("ends with a head of the same length that holds the duration", () => {
    const { firstHead, head } = record(3);
    expect(head.length).toBe(firstHead.length);
    expect(readWebmDurationMs(head)).toBe(3000);
  });
});

describe("withWebmDuration", () => {
  it("adds the duration to a recorder's head", () => {
    const original = recorderHead();
    const fixed = withWebmDuration(original, 2500)!;
    expect(fixed.replaces).toBeLessThan(original.length);
    const file = new Uint8Array([...fixed.head, ...original.subarray(fixed.replaces)]);
    expect(readWebmDurationMs(file)).toBe(2500);
  });

  it("leaves bytes that aren't WebM alone", () => {
    expect(withWebmDuration(new Uint8Array([1, 2, 3]), 1000)).toBeNull();
    expect(readWebmDurationMs(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
