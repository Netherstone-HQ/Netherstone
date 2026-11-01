import type { ImportIO, ImportSource } from "./engine";
import { ImportError } from "./types";

/**
 * Zip files picked or dropped for import are opened and their contents
 * imported like a folder with the zip file's name. When everything in it
 * sits in one folder, as when a folder was zipped, that folder is the one
 * imported. Zip files inside a zip file aren't opened.
 *
 * Nothing is unpacked to disk, and a zip file is never read whole: opening
 * one reads only its list of files, at its end, and each file is read out
 * of it when the import needs it, one at a time, and never unpacked past
 * the size the zip file gives for it. Zip files whose files share data,
 * which a well-formed one never does and zip bombs do to unpack far bigger
 * than they are, aren't opened at all. Nor are zip files that unpack bigger
 * than the free space on the vault's disk, together with the zip files
 * opened before them. Files whose names climb out of the zip file (`../`)
 * or start at a drive or the root are left out.
 */

/** Paths of files inside a zip file start with this, then the zip file's number. */
const PREFIX = "zip:";

const DAMAGED = "This zip file is damaged or has a password, so it wasn't opened.";
const OVERLAPPING = "The files in this zip file overlap each other, so it wasn't opened.";
const UNSAFE = "Its path in the zip file leads outside it, so it was left out.";
const BIGGER = "This file unpacks bigger than its zip file says, so it wasn't read.";
const SMALLER = "This file is cut short in its zip file, so it wasn't read.";
const NO_SPACE = "This zip file unpacks bigger than the free space on your vault's disk, so it wasn't opened.";

// The zip format's record signatures and the sizes of their fixed parts.
const LOCAL_HEADER = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_ENTRY = 0x02014b50;
const CENTRAL_ENTRY_SIZE = 46;
const END = 0x06054b50;
const END_SIZE = 22;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_END = 0x06064b50;
const ZIP64_END_SIZE = 56;
const ZIP64_EXTRA = 0x0001;
/** The longest comment the end record can carry. */
const MAX_COMMENT = 0xffff;
/** What a 16-bit or 32-bit field holds when the real value is in the ZIP64 fields. */
const IN_ZIP64_16 = 0xffff;
const IN_ZIP64_32 = 0xffffffff;
const STORED = 0;
const DEFLATED = 8;
/** General purpose flag: the file is encrypted. */
const ENCRYPTED = 0x1;

/** A file in a zip file, as its list of files gives it. */
interface ZipEntry {
  /** The zip file it's in, as the IO reads it. */
  zip: string;
  name: string;
  /** Its name's length in bytes, as the zip file stores it. */
  nameLength: number;
  method: number;
  compressedSize: number;
  size: number;
  /** Where its local header starts in the zip file. */
  offset: number;
  /** Where the list of files starts, which its data must end before. */
  listStart: number;
}

class Damaged extends Error {}

export interface OpenedArchives {
  /** The sources, each zip file replaced by the files in it. */
  sources: ImportSource[];
  /** The IO, reading files in zip files out of them. */
  io: ImportIO;
  /** Zip files that couldn't be opened and files left out of them. */
  failed: { source: string; error: string }[];
}

export function isArchive(relativePath: string) {
  return /\.zip$/i.test(relativePath);
}

/** Opens the zip files among `sources`, read through `io`. */
export async function openArchives(sources: ImportSource[], io: ImportIO): Promise<OpenedArchives> {
  if (!sources.some((source) => isArchive(source.relativePath))) return { sources, io, failed: [] };

  let archives = 0;
  /** What the zip files opened so far unpack to, in bytes. */
  let unpacked = 0;
  let free: Promise<number> | undefined;
  const entries = new Map<string, ZipEntry>();
  const opened: ImportSource[] = [];
  const failed: OpenedArchives["failed"] = [];

  for (const source of sources) {
    if (!isArchive(source.relativePath)) {
      opened.push(source);
      continue;
    }

    let files: ZipEntry[];
    try {
      files = await listEntries(io, source.path, source.size);
    } catch (error) {
      const message = error instanceof Damaged || !(error instanceof Error) ? DAMAGED : error.message;
      failed.push({ source: source.relativePath, error: message });
      continue;
    }
    if (files.length && overlaps(files)) {
      failed.push({ source: source.relativePath, error: OVERLAPPING });
      continue;
    }

    const kept: { path: string[]; entry: ZipEntry }[] = [];
    const unsafe: string[] = [];
    for (const entry of files) {
      const path = safePath(entry.name);
      if (!path) unsafe.push(entry.name);
      else if (!path.some(isNoise)) kept.push({ path, entry });
    }
    kept.sort((a, b) => compareSegments(a.path, b.path));

    const size = kept.reduce((total, { entry }) => total + entry.size, 0);
    try {
      free ??= io.freeSpace();
      if (unpacked + size > (await free)) {
        failed.push({ source: source.relativePath, error: NO_SPACE });
        continue;
      }
    } catch (error) {
      failed.push({ source: source.relativePath, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    unpacked += size;
    for (const name of unsafe) failed.push({ source: `${source.relativePath}/${name}`, error: UNSAFE });

    const number = archives++;

    // A zipped folder imports as that folder; anything else as one named after the zip file.
    const name = baseName(source.relativePath).replace(/\.zip$/i, "");
    const folder = dirName(source.relativePath);
    const firstFolder = kept.length && kept[0].path.length > 1 ? kept[0].path[0] : null;
    const isZippedFolder = firstFolder !== null && kept.every(({ path }) => path.length > 1 && path[0] === firstFolder);
    const root = [folder, isZippedFolder ? null : name].filter(Boolean).join("/");

    for (const { path, entry } of kept) {
      const inside = path.join("/");
      const at = `${PREFIX}${number}/${inside}`;
      entries.set(at, entry);
      opened.push({ path: at, relativePath: root ? `${root}/${inside}` : inside, size: entry.size });
    }
  }

  const inArchive = (path: string) => path.startsWith(PREFIX);
  return {
    sources: opened,
    failed,
    io: {
      ...io,
      readFile: (path) => {
        const entry = entries.get(path);
        return entry ? unpack(io, entry) : io.readFile(path);
      },
      // Files in a zip file have no path on disk to copy from.
      copyAttachment: io.copyAttachment
        ? (path) =>
            inArchive(path)
              ? unpack(io, entries.get(path)!).then((bytes) => io.saveAttachment(baseName(path), bytes))
              : io.copyAttachment!(path)
        : undefined,
      // Nor anything beside them to look for there.
      exists: io.exists ? async (path) => !inArchive(path) && io.exists!(path) : undefined,
    },
  };
}

/** Reads exactly `length` bytes at `offset` of `zip`, or throws when they aren't there. */
async function readExactly(io: ImportIO, zip: string, offset: number, length: number) {
  const bytes = await io.readRange(zip, offset, length);
  if (bytes.length !== length) throw new Damaged();
  return bytes;
}

const viewOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
/** A 64-bit field, which is only trusted while it fits a safe integer. */
function uint64(view: DataView, at: number) {
  const value = view.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Damaged();
  return Number(value);
}

/** The files in the zip file `zip` of `size` bytes, from its list of files. */
async function listEntries(io: ImportIO, zip: string, size: number): Promise<ZipEntry[]> {
  // The end record sits at the very end, after a comment of up to 64 KB.
  const tailLength = Math.min(size, END_SIZE + MAX_COMMENT);
  const tail = await readExactly(io, zip, size - tailLength, tailLength);
  const tailView = viewOf(tail);
  let end = -1;
  for (let at = tail.length - END_SIZE; at >= 0; at -= 1) {
    if (tailView.getUint32(at, true) === END && at + END_SIZE + tailView.getUint16(at + 20, true) <= tail.length) {
      end = at;
      break;
    }
  }
  if (end < 0) throw new Damaged();

  let disk = tailView.getUint16(end + 4, true);
  let listDisk = tailView.getUint16(end + 6, true);
  let count = tailView.getUint16(end + 10, true);
  let listSize = tailView.getUint32(end + 12, true);
  let listStart = tailView.getUint32(end + 16, true);
  const endAt = size - tailLength + end;
  if (count === IN_ZIP64_16 || listSize === IN_ZIP64_32 || listStart === IN_ZIP64_32) {
    if (endAt < ZIP64_LOCATOR_SIZE) throw new Damaged();
    const locator = viewOf(await readExactly(io, zip, endAt - ZIP64_LOCATOR_SIZE, ZIP64_LOCATOR_SIZE));
    if (locator.getUint32(0, true) !== ZIP64_LOCATOR) throw new Damaged();
    const zip64At = uint64(locator, 8);
    const zip64 = viewOf(await readExactly(io, zip, zip64At, ZIP64_END_SIZE));
    if (zip64.getUint32(0, true) !== ZIP64_END) throw new Damaged();
    disk = zip64.getUint32(16, true);
    listDisk = zip64.getUint32(20, true);
    count = uint64(zip64, 32);
    listSize = uint64(zip64, 40);
    listStart = uint64(zip64, 48);
  }
  // Zip files split over several files aren't read.
  if (disk !== 0 || listDisk !== 0 || listStart + listSize > endAt) throw new Damaged();

  const list = await readExactly(io, zip, listStart, listSize);
  const view = viewOf(list);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let index = 0; index < count; index += 1) {
    if (at + CENTRAL_ENTRY_SIZE > list.length || view.getUint32(at, true) !== CENTRAL_ENTRY) throw new Damaged();
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    let compressedSize = view.getUint32(at + 20, true);
    let entrySize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    let offset = view.getUint32(at + 42, true);
    const nameAt = at + CENTRAL_ENTRY_SIZE;
    const extraAt = nameAt + nameLength;
    const next = extraAt + extraLength + commentLength;
    if (next > list.length) throw new Damaged();
    const name = decoder.decode(list.subarray(nameAt, extraAt));

    // The ZIP64 field holds, in order, each size or offset too big for its own field.
    for (let field = extraAt; field + 4 <= extraAt + extraLength; ) {
      const id = view.getUint16(field, true);
      const length = view.getUint16(field + 2, true);
      if (id === ZIP64_EXTRA) {
        let value = field + 4;
        const take = () => {
          if (value + 8 > field + 4 + length) throw new Damaged();
          const read = uint64(view, value);
          value += 8;
          return read;
        };
        if (entrySize === IN_ZIP64_32) entrySize = take();
        if (compressedSize === IN_ZIP64_32) compressedSize = take();
        if (offset === IN_ZIP64_32) offset = take();
      }
      field += 4 + length;
    }

    at = next;
    if (name.endsWith("/")) continue;
    if (flags & ENCRYPTED || (method !== STORED && method !== DEFLATED)) throw new Damaged();
    if (method === STORED && compressedSize !== entrySize) throw new Damaged();
    entries.push({ zip, name, nameLength, method, compressedSize, size: entrySize, offset, listStart });
  }
  return entries;
}

/**
 * Whether any two files' data may share bytes of the zip file. Each file
 * takes at least its local header, as long as its name, and its data; a
 * well-formed zip file puts the next file after that, and before the list
 * of files.
 */
function overlaps(entries: ZipEntry[]) {
  const ranges = entries
    .map((entry) => [entry.offset, entry.offset + LOCAL_HEADER_SIZE + entry.nameLength + entry.compressedSize])
    .sort((a, b) => a[0] - b[0]);
  return ranges.some(
    ([start, end], index) => end > entries[0].listStart || (index > 0 && start < ranges[index - 1][1]),
  );
}

/** A file's bytes, read out of its zip file and never unpacked past the size it gives. */
async function unpack(io: ImportIO, entry: ZipEntry): Promise<Uint8Array> {
  let data: Uint8Array;
  try {
    const header = viewOf(await readExactly(io, entry.zip, entry.offset, LOCAL_HEADER_SIZE));
    if (header.getUint32(0, true) !== LOCAL_HEADER) throw new Damaged();
    const dataStart = entry.offset + LOCAL_HEADER_SIZE + header.getUint16(26, true) + header.getUint16(28, true);
    if (dataStart + entry.compressedSize > entry.listStart) throw new Damaged();
    data = await readExactly(io, entry.zip, dataStart, entry.compressedSize);
  } catch (error) {
    throw error instanceof Damaged ? new ImportError(SMALLER) : error;
  }
  if (entry.method === STORED) return data;

  // Unpacked as it comes, a piece at a time, so a file that says it's
  // small can't take more memory than it says.
  const chunks: Uint8Array[] = [];
  let length = 0;
  const reader = new Response(data as BodyInit).body!.pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > entry.size) throw new ImportError(BIGGER);
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error instanceof ImportError ? error : new ImportError(SMALLER);
  }
  if (length !== entry.size) throw new ImportError(SMALLER);
  const bytes = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return bytes;
}

/** A path in a zip file as folder and file names, or null when it isn't safe to follow. */
function safePath(name: string): string[] | null {
  const posix = name.replace(/\\/g, "/");
  if (posix.startsWith("/") || /^[a-z]:/i.test(posix)) return null;
  const segments = posix.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.includes("..")) return null;
  return segments;
}

/** Left out like the backend leaves them out of picked folders, with the folder macOS adds to zip files. */
function isNoise(segment: string) {
  return segment.startsWith(".") || segment === "node_modules" || segment === "__MACOSX";
}

/** Sorted by name folder by folder, the way picked folders are walked. */
function compareSegments(a: string[], b: string[]) {
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = a[index].toLowerCase().localeCompare(b[index].toLowerCase());
    if (order) return order;
  }
  return a.length - b.length;
}

function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirName(path: string) {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}
