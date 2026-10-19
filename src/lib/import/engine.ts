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
  saveShard(path: string, markdown: string): Promise<void>;
  /** Stores an attachment and returns its link, `_attachments/photo.png`. */
  saveAttachment(name: string, bytes: Uint8Array): Promise<string>;
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
  /** Files that aren't documents Netherstone reads and no document used, by path. */
  skipped: string[];
  failed: { source: string; error: string }[];
  cancelled: boolean;
}

export interface RunImportOptions {
  sources: ImportSource[];
  /** The vault folder the shards go in. */
  targetDir: string;
  io: ImportIO;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  /** Overrides the format lookup; tests pass their own. */
  importerFor?: (fileName: string) => Importer | null;
}

class Cancelled extends Error {}

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
  for (const segment of target.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.join("/");
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
  const { io, signal, onProgress } = options;
  const lookup = options.importerFor ?? importerFor;
  const report: ImportReport = { created: [], skipped: [], failed: [], cancelled: false };

  const documents: { source: ImportSource; importer: Importer }[] = [];
  for (const source of options.sources) {
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

  const index = new SourceIndex(options.sources);
  const attachments = new Map<string, Promise<string | null>>();
  const used = new Set<string>();
  const total = documents.length;

  const checkCancelled = () => {
    if (signal?.aborted) throw new Cancelled();
  };

  for (let position = 0; position < documents.length; position += 1) {
    const { source, importer } = documents[position];
    const destination = destinationOf.get(source)!;
    const warnings: string[] = [];
    onProgress?.({ done: position, total, current: source.relativePath });

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
      addAttachment: (attachmentName, bytes) => io.saveAttachment(attachmentName, bytes),
      attachRelated: (target) => {
        const related = index.find(source.relativePath, target);
        if (!related) return Promise.resolve(null);
        used.add(related.relativePath);
        // A picture many files use is read and stored once.
        let link = attachments.get(related.path);
        if (!link) {
          link = io
            .readFile(related.path)
            .then((bytes) => io.saveAttachment(baseName(POSIX(related.relativePath)), bytes))
            .catch(() => null);
          attachments.set(related.path, link);
        }
        return link;
      },
      linkTo: (target) => {
        const linked = index.find(source.relativePath, target, ["md", "html", "htm", "docx", "txt"]);
        const linkedDestination = linked ? destinationOf.get(linked) : undefined;
        if (!linkedDestination) return null;
        return encodeShardLinkPath(relativePath(destination, linkedDestination));
      },
      report: (detail) => onProgress?.({ done: position, total, current: source.relativePath, detail }),
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
      const markdown =
        output.markdown !== undefined ? output.markdown : await io.serialize(output.nodes, destination);
      checkCancelled();
      await io.saveShard(destination, markdown);
      report.created.push({ source: source.relativePath, path: destination, format: importer.label, warnings });
    } catch (error) {
      if (error instanceof Cancelled || (error instanceof DOMException && error.name === "AbortError")) {
        report.cancelled = true;
        break;
      }
      report.failed.push({ source: source.relativePath, error: describeError(error) });
    }

    await io.yield();
  }

  // Pictures and files the documents brought in weren't left out.
  report.skipped = report.skipped.filter((path) => !used.has(path));
  onProgress?.({ done: report.created.length + report.failed.length, total, current: null });
  return report;
}
