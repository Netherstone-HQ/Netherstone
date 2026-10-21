import { invoke } from "@tauri-apps/api/core";

export type VersionKind =
  | "created"
  | "edited"
  | "outsideChange"
  | "restored"
  | "synced";

/** An earlier version of a shard or drawing, from the vault's local history. */
export type FileVersion = {
  /** The commit that saved it. */
  id: string;
  /** Its content, as a blob id. */
  blob: string;
  /** Unix seconds. */
  time: number;
  kind: VersionKind;
  /** For a restored version, when the version it brought back was saved. */
  restoredFrom: number | null;
  /** Words (shards) or shapes (drawings) compared with the version before. */
  added: number;
  removed: number;
  /** Shapes changed in place. */
  changed: number;
  /** False when the counts above weren't worked out. */
  counted: boolean;
};

export type RestoreResult = {
  /** What the file holds now. */
  content: string;
  /** The version saved just before restoring, which Undo brings back. */
  undo: { blob: string; time: number } | null;
};

/** A file's history, for the history panel. */
export type FileHistory = {
  /**
   * When the file as it is now was saved as a version (Unix seconds), or
   * null when it changed since or was never saved.
   */
  savedAt: number | null;
  /** Its earlier versions, newest first. The file as it is now isn't one. */
  versions: FileVersion[];
};

export function listVersions(vaultPath: string, filePath: string) {
  return invoke<FileHistory>("history_list_versions", {
    vaultPath,
    filePath,
  });
}

export function readVersion(vaultPath: string, blob: string) {
  return invoke<string>("history_read_version", { vaultPath, blob });
}

/**
 * Puts a version back. The file as it is now is saved as a version first.
 * For a shard, `expectedContent` is its text as the app last read or wrote
 * it; nothing is restored if the file changed outside the app since.
 */
export function restoreVersion(
  vaultPath: string,
  filePath: string,
  version: { blob: string; time: number },
  expectedContent?: string,
) {
  return invoke<RestoreResult>("history_restore", {
    vaultPath,
    filePath,
    blob: version.blob,
    versionTime: version.time,
    expectedContent,
  });
}

// ── Words ────────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(date: Date) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

/** 0 for today, 1 for yesterday, and so on. */
function daysAgo(seconds: number, now: Date) {
  return Math.round(
    (startOfDay(now) - startOfDay(new Date(seconds * 1000))) / DAY_MS,
  );
}

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function dateFormat(seconds: number, now: Date, month: "long" | "short") {
  const date = new Date(seconds * 1000);
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month,
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function formatTime(seconds: number) {
  return timeFormat.format(new Date(seconds * 1000));
}

/** The heading over a day's versions: "Today", "Yesterday", "12 October". */
export function formatDay(seconds: number, now = new Date()) {
  const days = daysAgo(seconds, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return dateFormat(seconds, now, "long");
}

/** A version's name on its own: "Today, 11:05", "12 Oct, 19:30". */
export function formatVersionTitle(seconds: number, now = new Date()) {
  const days = daysAgo(seconds, now);
  const day =
    days === 0
      ? "Today"
      : days === 1
        ? "Yesterday"
        : dateFormat(seconds, now, "short");
  return `${day}, ${formatTime(seconds)}`;
}

/** A version named in a sentence: "11:05", "yesterday, 18:03", "12 Oct, 19:30". */
export function formatVersionMoment(seconds: number, now = new Date()) {
  const days = daysAgo(seconds, now);
  if (days === 0) return formatTime(seconds);
  const day = days === 1 ? "yesterday" : dateFormat(seconds, now, "short");
  return `${day}, ${formatTime(seconds)}`;
}

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Added 14 words, removed 2". The unit is only said once. */
function describeCounts(
  parts: [label: string, n: number][],
  one: string,
  many: string,
) {
  const named = parts.filter(([, n]) => n > 0);
  return named
    .map(([label, n], index) => {
      const said = index === 0 ? count(n, one, many) : String(n);
      return `${index === 0 ? label : label.toLowerCase()} ${said}`;
    })
    .join(", ");
}

/** The line under a version's time in the history panel. */
export function describeVersion(
  version: FileVersion,
  isDrawing: boolean,
  now = new Date(),
) {
  switch (version.kind) {
    case "created":
      return "Created";
    case "outsideChange":
      return "Changed outside the app";
    case "synced":
      return "Changed on another device";
    case "restored":
      return version.restoredFrom === null
        ? "Restored"
        : `Restored from ${formatVersionMoment(version.restoredFrom, now)}`;
    case "edited":
      break;
  }
  if (!version.counted) return "Edited";
  const line = isDrawing
    ? describeCounts(
        [
          ["Added", version.added],
          ["Changed", version.changed],
          ["Removed", version.removed],
        ],
        "shape",
        "shapes",
      )
    : describeCounts(
        [
          ["Added", version.added],
          ["Removed", version.removed],
        ],
        "word",
        "words",
      );
  return line || (isDrawing ? "Changed the canvas" : "Changed formatting");
}

export type VersionDay = { label: string; versions: FileVersion[] };

/** Versions grouped by the day they were saved, newest first. */
export function groupByDay(
  versions: FileVersion[],
  now = new Date(),
): VersionDay[] {
  const days: VersionDay[] = [];
  for (const version of versions) {
    const label = formatDay(version.time, now);
    const last = days[days.length - 1];
    if (last?.label === label) last.versions.push(version);
    else days.push({ label, versions: [version] });
  }
  return days;
}
