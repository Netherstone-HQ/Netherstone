/**
 * A PNG from raw pixels, without a canvas, so pictures can be taken out of
 * PDFs anywhere the import runs. Compression is the platform's own
 * `CompressionStream("deflate")`, which writes the zlib stream PNG needs.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let index = 0; index < bytes.length; index += 1) c = CRC_TABLE[(c ^ bytes[index]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflate(data: Uint8Array) {
  const stream = new Response(data as BodyInit).body!.pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** `channels` is 1 (grey), 3 (RGB) or 4 (RGBA); rows are packed. */
export async function encodePng(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 1 | 3 | 4) {
  const rowLength = width * channels;
  const raw = new Uint8Array((rowLength + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (rowLength + 1)] = 0;
    raw.set(pixels.subarray(row * rowLength, (row + 1) * rowLength), row * (rowLength + 1) + 1);
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", await deflate(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Unpacks 1-bit rows (pdf.js `GRAYSCALE_1BPP`) to one byte per pixel. */
export function unpackBits(data: Uint8Array | Uint8ClampedArray, width: number, height: number) {
  const out = new Uint8Array(width * height);
  const rowBytes = (width + 7) >> 3;
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const bit = (data[row * rowBytes + (col >> 3)] >> (7 - (col & 7))) & 1;
      out[row * width + col] = bit ? 255 : 0;
    }
  }
  return out;
}
