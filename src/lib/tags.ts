import { invoke } from "@tauri-apps/api/core";

export interface TagLine {
  tag: string;
  /** The first line that contains `#tag`, as written in the file. */
  line: string | null;
}

export interface TaggedFile {
  path: string;
  name: string;
  /** Seconds since the epoch. */
  last_modified: number;
  /** In the order they first appear in the file. */
  tags: TagLine[];
}

export interface TagCount {
  tag: string;
  count: number;
}

/** Every tagged shard in the open vault, newest first. */
export function getTaggedFiles() {
  return invoke<TaggedFile[]>("get_tagged_files");
}

/** Each tag with the number of shards that use it, most used first. */
export function countTags(files: TaggedFile[]): TagCount[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    for (const { tag } of file.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** Whether `tag` matches what's typed in Filter tags, with or without a #. */
export function matchesTagFilter(tag: string, filter: string) {
  const query = filter.trim().replace(/^#/, "").toLowerCase();
  return tag.toLowerCase().includes(query);
}

const isPunctuation = (char: string) => /^[!-/:-@[-`{-~]$/.test(char);

/**
 * Where `#tag` starts in `text` as a whole tag, the way the indexer reads it:
 * not inside a longer word, and followed only by punctuation before the next
 * space. -1 when it isn't there.
 */
export function findTag(text: string, tag: string) {
  const needle = `#${tag}`;
  for (
    let start = text.indexOf(needle);
    start >= 0;
    start = text.indexOf(needle, start + 1)
  ) {
    const previous = text[start - 1];
    const startsWord =
      previous === undefined ||
      /\s/.test(previous) ||
      (isPunctuation(previous) && previous !== "#");
    const rest = text.slice(start + needle.length);
    const wordEnd = rest.search(/\s/);
    const trailing = wordEnd < 0 ? rest : rest.slice(0, wordEnd);
    if (startsWord && [...trailing].every(isPunctuation)) return start;
  }
  return -1;
}

/** Quote, heading, list and task markers at the start of a line. */
const BLOCK_MARKERS =
  /^\s*(?:>\s?)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?/;

/**
 * A line of Markdown as it reads in the editor: without quote, heading, list
 * and task markers, link targets, emphasis marks, inline HTML or escapes.
 */
export function toPlainLine(line: string) {
  return line
    .replace(BLOCK_MARKERS, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(^|[^\w*])[*_](?=\S)(.+?)(?<=\S)[*_](?![\w*])/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\\([!-/:-@[-`{-~])/g, "$1")
    .trim();
}

/** How much of the line before the tag stays visible. */
const MAX_LEAD_CHARS = 60;

/**
 * The line split around `#tag` so the tag can be highlighted. A long run of
 * text before the tag is shortened to the words nearest it.
 */
export function splitAtTag(line: string, tag: string) {
  const text = toPlainLine(line);
  const start = findTag(text, tag);
  if (start < 0) return { before: text, match: null, after: "" };

  let before = text.slice(0, start);
  if (before.length > MAX_LEAD_CHARS) {
    before = `…${before.slice(-MAX_LEAD_CHARS).replace(/^\S*\s+/, "")}`;
  }
  return {
    before,
    match: `#${tag}`,
    after: text.slice(start + tag.length + 1),
  };
}

/** "Today", "Yesterday", "Oct 11", or "Oct 11, 2025" in another year. */
export function formatModified(
  seconds: number,
  now = new Date(),
  locale?: string,
) {
  const date = new Date(seconds * 1000);
  const startOfDay = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}
