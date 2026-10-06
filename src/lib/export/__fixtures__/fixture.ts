import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

import { loadMarkdown } from "@/test/markdown";

import type { ImageMap } from "../assets";
import { buildExportDocument } from "../build";

export const ROOT = path.resolve(__dirname, "../../../..");
const FIXTURE = fs.readFileSync(path.join(__dirname, "everything.md"), "utf8");

/** A striped RGB PNG, built by hand so tests need no image library. */
export function testPng(width: number, height: number): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows: number[] = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(0);
    for (let x = 0; x < width; x += 1) {
      const band = Math.floor(x / (width / 6));
      const colors = [[43, 106, 91], [79, 163, 142], [143, 209, 190], [196, 235, 223], [238, 235, 229], [20, 21, 22]];
      rows.push(...colors[band % colors.length]);
    }
  }
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", zlib.deflateSync(Buffer.from(rows))),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

export function fixtureDocument() {
  const value = loadMarkdown(FIXTURE) as unknown[];
  return buildExportDocument(value, { fileName: "everything", locale: "en-US" });
}

export function fixtureImages(doc: ReturnType<typeof fixtureDocument>): ImageMap {
  const images: ImageMap = new Map();
  for (const request of doc.images) {
    images.set(request.id, { bytes: testPng(480, 240), mime: "image/png", width: 480, height: 240 });
  }
  return images;
}

