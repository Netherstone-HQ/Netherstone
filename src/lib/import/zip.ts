import JSZip from "jszip";

import type { ImportIO, ImportSource } from "./engine";
import { ImportError } from "./types";

/**
 * Zip files picked or dropped for import are opened and their contents
 * imported like a folder with the zip file's name. When everything in it
 * sits in one folder, as when a folder was zipped, that folder is the one
 * imported. Zip files inside a zip file aren't opened.
 *
 * Nothing is unpacked to disk: each file is read out of the zip file when
 * the import needs it, one at a time, and never past the size the zip
 * file gives for it. Zip files whose files share data, which a
 * well-formed one never does and zip bombs do to unpack far bigger than
 * they are, aren't opened at all. Files whose names climb out of the zip
 * file (`../`) or start at a drive or the root are left out.
 */

/** Paths of files inside a zip file start with this, then the zip file's number. */
const PREFIX = "zip:";

const DAMAGED = "This zip file is damaged or has a password, so it wasn't opened.";
const OVERLAPPING = "The files in this zip file overlap each other, so it wasn't opened.";
const UNSAFE = "Its path in the zip file leads outside it, so it was left out.";
const BIGGER = "This file unpacks bigger than its zip file says, so it wasn't read.";
const SMALLER = "This file is cut short in its zip file, so it wasn't read.";
const TOO_BIG = "This file is too big to unpack, so it wasn't read.";

/** The part of JSZip's entry state that isn't in its types. */
interface ZipEntry extends JSZip.JSZipObject {
  _data: { compressedSize: number; uncompressedSize: number; compressedContent: unknown };
  internalStream(type: "uint8array"): JSZip.JSZipStreamHelper<Uint8Array>;
}

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
  const entries = new Map<string, ZipEntry>();
  const opened: ImportSource[] = [];
  const failed: OpenedArchives["failed"] = [];

  for (const source of sources) {
    if (!isArchive(source.relativePath)) {
      opened.push(source);
      continue;
    }

    let bytes: Uint8Array;
    try {
      bytes = await io.readFile(source.path);
    } catch (error) {
      failed.push({ source: source.relativePath, error: error instanceof Error ? error.message : String(error) });
      continue;
    }
    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(bytes);
    } catch {
      failed.push({ source: source.relativePath, error: DAMAGED });
      continue;
    }

    const files = Object.values(zip.files).filter((entry) => !entry.dir) as ZipEntry[];
    if (overlaps(files)) {
      failed.push({ source: source.relativePath, error: OVERLAPPING });
      continue;
    }

    const number = archives++;
    const kept: { path: string[]; entry: ZipEntry }[] = [];
    for (const entry of files) {
      const path = safePath(entry.unsafeOriginalName ?? entry.name);
      if (!path) failed.push({ source: `${source.relativePath}/${entry.unsafeOriginalName ?? entry.name}`, error: UNSAFE });
      else if (!path.some(isNoise)) kept.push({ path, entry });
    }
    kept.sort((a, b) => compareSegments(a.path, b.path));

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
      opened.push({ path: at, relativePath: root ? `${root}/${inside}` : inside, size: entry._data.uncompressedSize });
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
        return entry ? unpack(entry) : io.readFile(path);
      },
      // Files in a zip file have no path on disk to copy from.
      copyAttachment: io.copyAttachment
        ? (path) =>
            inArchive(path)
              ? unpack(entries.get(path)!).then((bytes) => io.saveAttachment(baseName(path), bytes))
              : io.copyAttachment!(path)
        : undefined,
      // Nor anything beside them to look for there.
      exists: io.exists ? async (path) => !inArchive(path) && io.exists!(path) : undefined,
    },
  };
}

/**
 * Whether any two files' data share bytes of the zip file. Each file's data
 * is a view into the zip file's bytes, so where it starts is its offset.
 * Without that view there's no telling, and the zip file isn't trusted.
 */
function overlaps(files: ZipEntry[]) {
  const ranges: [number, number][] = [];
  for (const { _data: data } of files) {
    const content = data.compressedContent;
    if (!(content instanceof Uint8Array)) return true;
    if (content.length) ranges.push([content.byteOffset, content.byteOffset + content.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.some(([start], index) => index > 0 && start < ranges[index - 1][1]);
}

/** A file's bytes, never unpacked past the size the zip file gives for it. */
function unpack(entry: ZipEntry): Promise<Uint8Array> {
  const size = entry._data.uncompressedSize;
  return new Promise((resolve, reject) => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(size);
    } catch {
      return reject(new ImportError(TOO_BIG));
    }
    let length = 0;
    let isDone = false;
    const fail = (error: Error) => {
      if (isDone) return;
      isDone = true;
      stream.pause();
      reject(error);
    };
    const stream = entry
      .internalStream("uint8array")
      .on("data", (chunk) => {
        if (isDone) return;
        if (length + chunk.length > size) return fail(new ImportError(BIGGER));
        bytes.set(chunk, length);
        length += chunk.length;
      })
      .on("error", (error) => fail(error))
      .on("end", () => {
        if (isDone) return;
        if (length !== size) return fail(new ImportError(SMALLER));
        isDone = true;
        resolve(bytes);
      });
    stream.resume();
  });
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
