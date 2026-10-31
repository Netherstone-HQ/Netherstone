import {
  encodeShardLinkPath,
  relativePath,
} from "@/lib/markdown-shard-links";

import { importerFor } from "./registry";
import {
  ImportError,
  type ImportContext,
  type ImportFile,
  type Importer,
  type PlateNode,
} from "./types";
import { openArchives } from "./zip";

/** A file the person picked, as the backend lists it. */
export interface ImportSource {
  path: string;
  /** `Notes/Plans/Q3.docx`: the picked folder's name, then the file's path in it. */
  relativePath: string;
  size: number;
}

/** What the engine needs from the outside world; `app-io.ts` is the app's. */
export interface ImportIO {
  readFile(path: string): Promise<Uint8Array>;
  /** Free `.md` paths in `targetDir`, one per `Folder/Name`, in order. */
  reservePaths(targetDir: string, relativePaths: string[]): Promise<string[]>;
  /**
   * Writes a shard at a reserved path, or at the next free name when
   * something took that one since. Returns where it went.
   */
  saveShard(path: string, markdown: string): Promise<string>;
  /** Points the links in saved `shards` to `oldPath` at `newPath`. */
  fixLinks(shards: string[], oldPath: string, newPath: string): Promise<void>;
  /** Stores an attachment and returns its link, `_attachments/photo.png`. */
  saveAttachment(name: string, bytes: Uint8Array): Promise<string>;
  /**
   * Copies the file at `path` in as an attachment and returns its link.
   * Left out where files have no path on disk (dropped in); they are read
   * and stored with `saveAttachment` instead.
   */
  copyAttachment?(path: string): Promise<string>;
  /**
   * Whether a path exists on disk. Left out where files have no path on
   * disk (dropped in), so files they use can't be looked for there.
   */
  exists?(path: string): Promise<boolean>;
  /** Writes a Plate value as the Markdown of the shard at `filePath`. */
  serialize(nodes: PlateNode[], filePath: string): Promise<string>;
  /** Lets the window paint between steps. */
  yield(): Promise<void>;
}

export interface ImportProgress {
  /** Files finished, whether imported or failed. */
  done: number;
  total: number;
  /** The file being converted now. */
  current: string | null;
  /** Where in that file, for long ones: `Page 3 of 40`. */
  detail?: string;
}

export interface ImportedShard {
  source: string;
  path: string;
  format: string;
  warnings: string[];
}

export interface ImportReport {
  created: ImportedShard[];
  /** Every attachment the shards link to, new or already in the vault. */
  attachments: string[];
  /** Files that aren't documents Netherstone reads and no document used, by path. */
  skipped: string[];
  failed: { source: string; error: string }[];
  cancelled: boolean;
}

export interface RunImportOptions {
  sources: ImportSource[];
  /** The vault folder the shards go in. */
  targetDir: string;
  /**
   * Copies the pictures, sound, video and files shards use into the vault's
   * attachments. Off, their links stay as written. On by default.
   */
  bringAttachments?: boolean;
  io: ImportIO;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  /** Overrides the format lookup; tests pass their own. */
  importerFor?: (fileName: string) => Importer | null;
}

class Cancelled extends Error {}

/** How many files are read at once: two is about a quarter faster than one, more adds little. */
const AT_ONCE = 2;

const POSIX = (path: string) => path.replace(/\\/g, "/");

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function withoutExtension(path: string) {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash + 1 ? path.slice(0, dot) : path;
}

function baseName(path: string) {
  return path.slice(path.lastIndexOf("/") + 1);
}

function dirName(path: string) {
  const slash = path.lastIndexOf("/");
  return slash >= 0 ? path.slice(0, slash) : "";
}

/** Resolves `.` and `..` in a relative path; null when it climbs out. */
function joinRelative(base: string, target: string): string | null {
  const parts = base ? base.split("/") : [];
  // An absolute base keeps its root: `/` or `C:`.
  const floor = base.startsWith("/") || /^[a-z]:/i.test(base) ? 1 : 0;
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length <= floor) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
}

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `target` as a plain relative path, or null for URLs and absolute paths. */
function relativeTarget(target: string) {
  const cleaned = POSIX(decode(target.trim())).replace(/^<|>$/g, "");
  if (!cleaned || cleaned.startsWith("/") || URL_SCHEME.test(cleaned)) return null;
  return cleaned;
}

function decode(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** The people-facing message for an error thrown while importing a file. */
function describeError(error: unknown) {
  if (error instanceof ImportError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return message || "Something went wrong reading this file.";
}

/**
 * Lookups over every file the person picked, documents or not, so links and
 * embeds can find what they point at.
 */
class SourceIndex {
  private readonly byPath = new Map<string, ImportSource>();
  private readonly byName = new Map<string, ImportSource[]>();

  constructor(sources: ImportSource[]) {
    for (const source of sources) {
      const path = POSIX(source.relativePath);
      this.byPath.set(path.toLowerCase(), source);
      const name = baseName(path).toLowerCase();
      this.byName.set(name, [...(this.byName.get(name) ?? []), source]);
    }
  }

  /**
   * The file `target` points at from `fromPath`: by relative path first,
   * then (for bare names, as wiki links use) by name anywhere in the import,
   * with or without an extension.
   */
  find(fromPath: string, target: string, extensions: string[] = []): ImportSource | null {
    const cleaned = POSIX(decode(target.trim())).replace(/^<|>$/g, "");
    if (!cleaned) return null;

    const candidates = [cleaned, ...extensions.map((ext) => `${cleaned}.${ext}`)];
    const base = dirName(POSIX(fromPath));
    for (const candidate of candidates) {
      const joined = joinRelative(base, candidate);
      const hit = joined !== null ? this.byPath.get(joined.toLowerCase()) : undefined;
      if (hit) return hit;
    }

    if (cleaned.includes("/") && !cleaned.startsWith("../") && !cleaned.startsWith("./")) {
      // Obsidian writes vault-absolute paths without a leading slash.
      const root = POSIX(fromPath).split("/")[0];
      for (const candidate of candidates) {
        const hit = this.byPath.get(`${root}/${candidate}`.toLowerCase());
        if (hit) return hit;
      }
    }

    for (const candidate of candidates) {
      const matches = this.byName.get(baseName(candidate).toLowerCase());
      if (matches?.length) return closest(matches, fromPath);
    }
    return null;
  }
}

/** Of several files with one name, the one sharing the most folders. */
function closest(matches: ImportSource[], fromPath: string) {
  if (matches.length === 1) return matches[0];
  const from = POSIX(fromPath).split("/");
  let best = matches[0];
  let bestScore = -1;
  for (const match of matches) {
    const parts = POSIX(match.relativePath).split("/");
    let score = 0;
    while (score < from.length && score < parts.length && from[score] === parts[score]) score += 1;
    if (score > bestScore) {
      best = match;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Imports `sources` into `targetDir`, one shard per document. Every file
 * that can't be read is reported instead of stopping the rest; nothing in
 * the vault is ever overwritten.
 */
export async function runImport(options: RunImportOptions): Promise<ImportReport> {
  const { signal, onProgress } = options;
  const lookup = options.importerFor ?? importerFor;
  const bringAttachments = options.bringAttachments ?? true;
  // Zip files import like the folders in them.
  const { sources, io, failed } = await openArchives(options.sources, options.io);
  const report: ImportReport = { created: [], attachments: [], skipped: [], failed, cancelled: false };

  const documents: { source: ImportSource; importer: Importer }[] = [];
  for (const source of sources) {
    const importer = lookup(baseName(POSIX(source.relativePath)));
    if (importer) documents.push({ source, importer });
    else report.skipped.push(source.relativePath);
  }

  if (documents.length === 0) return report;

  // Every shard's path is known before the first is written, so links
  // between imported files point at the right place whatever order they
  // are converted in.
  const destinations = await io.reservePaths(
    options.targetDir,
    documents.map(({ source }) => withoutExtension(POSIX(source.relativePath))),
  );
  const destinationOf = new Map<ImportSource, string>();
  documents.forEach(({ source }, index) => destinationOf.set(source, destinations[index]));
  const reserved = new Map(destinationOf);
  /** For each imported file, the documents whose shards link to it. */
  const linkedFrom = new Map<ImportSource, Set<ImportSource>>();
  const saved = new Set<ImportSource>();

  const index = new SourceIndex(sources);
  const attachments = new Map<string, Promise<string | null>>();
  const linked = new Set<string>();
  const used = new Set<string>();
  const total = documents.length;

  /** Reads and stores a file once, however many shards use it. */
  const attach = (path: string, name: string) => {
    let link = attachments.get(path);
    if (!link) {
      const stored = io.copyAttachment
        ? io.copyAttachment(path)
        : io.readFile(path).then((bytes) => io.saveAttachment(name, bytes));
      link = stored.catch(() => null);
      attachments.set(path, link);
    }
    return link;
  };

  // Netherstone writes attachment links from the vault's root
  // (`_attachments/x.png`), so a shard from another vault finds them from
  // the folder above it that holds `_attachments`. Found once per folder.
  const roots = new Map<string, Promise<string | null>>();
  const vaultRootOf = (dir: string, exists: (path: string) => Promise<boolean>) => {
    let root = roots.get(dir);
    if (!root) {
      root = (async () => {
        for (let current = dir; current; current = dirName(current)) {
          if (await exists(`${current}/_attachments`).catch(() => false)) return current;
        }
        return null;
      })();
      roots.set(dir, root);
    }
    return root;
  };

  /** A file a shard uses that wasn't picked, found where the shard is on disk. */
  const findOnDisk = async (source: ImportSource, target: string) => {
    const exists = io.exists;
    const relative = relativeTarget(target);
    if (!exists || !relative) return null;
    const dir = dirName(POSIX(source.path));
    const beside = joinRelative(dir, relative);
    if (beside && (await exists(beside).catch(() => false))) return beside;
    const root = await vaultRootOf(dir, exists);
    const fromRoot = root ? joinRelative(root, relative) : null;
    if (fromRoot && fromRoot !== beside && (await exists(fromRoot).catch(() => false))) return fromRoot;
    return null;
  };

  const checkCancelled = () => {
    if (signal?.aborted) throw new Cancelled();
  };

  /** Files read and written so far. */
  let done = 0;

  const importOne = async ({ source, importer }: (typeof documents)[number]) => {
    const destination = destinationOf.get(source)!;
    const warnings: string[] = [];
    /** The imported files its shard links to. */
    const linksTo = new Set<ImportSource>();
    let missingFiles = 0;
    onProgress?.({ done, total, current: source.relativePath });

    const name = baseName(POSIX(source.relativePath));
    const file: ImportFile = {
      name,
      relativePath: source.relativePath,
      extension: extensionOf(name),
      size: source.size,
      read: () => io.readFile(source.path),
    };

    const context: ImportContext = {
      file,
      shardPath: destination,
      addAttachment: async (attachmentName, bytes) => {
        const link = await io.saveAttachment(attachmentName, bytes);
        linked.add(link);
        return link;
      },
      attachRelated: async (target) => {
        if (!bringAttachments) return decode(target);
        const related = index.find(source.relativePath, target);
        if (related) used.add(related.relativePath);
        const onDisk = related ? null : await findOnDisk(source, target);
        const link = related
          ? await attach(related.path, baseName(POSIX(related.relativePath)))
          : onDisk
            ? await attach(onDisk, baseName(onDisk))
            : null;
        if (link) linked.add(link);
        else missingFiles += 1;
        return link;
      },
      linkTo: (target) => {
        const linked = index.find(source.relativePath, target, ["md", "html", "htm", "docx", "txt"]);
        const linkedDestination = linked ? destinationOf.get(linked) : undefined;
        if (!linked || !linkedDestination) return null;
        linkedFrom.set(linked, (linkedFrom.get(linked) ?? new Set()).add(source));
        linksTo.add(linked);
        return encodeShardLinkPath(relativePath(destination, linkedDestination));
      },
      report: (detail) => onProgress?.({ done, total, current: source.relativePath, detail }),
      warn: (message) => {
        if (!warnings.includes(message)) warnings.push(message);
      },
      checkpoint: async () => {
        checkCancelled();
        await io.yield();
        checkCancelled();
      },
    };

    try {
      checkCancelled();
      const output = await importer.convert(file, context);
      checkCancelled();
      if (missingFiles > 0) {
        const message =
          missingFiles === 1 ? "1 file it uses wasn't found." : `${missingFiles} files it uses weren't found.`;
        context.warn(io.exists ? message : `${message} Pick it with Files to bring its attachments.`);
      }
      const markdown =
        output.markdown !== undefined ? output.markdown : await io.serialize(output.nodes, destination);
      checkCancelled();
      const savedAt = await io.saveShard(destination, markdown);
      saved.add(source);
      // A shard read alongside this one may have moved while this one was read.
      for (const target of linksTo) {
        const moved = destinationOf.get(target)!;
        if (moved !== reserved.get(target)) {
          await io
            .fixLinks([savedAt], reserved.get(target)!, moved)
            .catch(() => context.warn("Some links to other imported shards weren't updated."));
        }
      }
      if (savedAt !== destination) {
        // Something took the name since it was reserved. Shards linking to
        // it from now on find it where it went; those already saved are fixed.
        destinationOf.set(source, savedAt);
        const linking = [...(linkedFrom.get(source) ?? [])]
          .filter((from) => from !== source && saved.has(from))
          .map((from) => destinationOf.get(from)!);
        if (linking.length) {
          await io
            .fixLinks(linking, destination, savedAt)
            .catch(() => context.warn("Links to it from other imported shards weren't updated."));
        }
      }
      report.created.push({ source: source.relativePath, path: savedAt, format: importer.label, warnings });
    } catch (error) {
      if (error instanceof Cancelled || (error instanceof DOMException && error.name === "AbortError")) {
        report.cancelled = true;
        return;
      }
      report.failed.push({ source: source.relativePath, error: describeError(error) });
    }

    done += 1;
    await io.yield();
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, documents.length) }, async () => {
      while (next < documents.length && !report.cancelled) await importOne(documents[next++]);
    }),
  );
  // Listed in the order they were picked, not the order they finished.
  const order = new Map(documents.map(({ source }, position) => [source.relativePath, position]));
  report.created.sort((a, b) => order.get(a.source)! - order.get(b.source)!);

  // Pictures and files the documents brought in weren't left out.
  report.skipped = report.skipped.filter((path) => !used.has(path));
  report.attachments = [...linked];
  onProgress?.({ done: report.created.length + report.failed.length, total, current: null });
  return report;
}
