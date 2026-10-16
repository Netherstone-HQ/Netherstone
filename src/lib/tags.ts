import { invoke } from "@tauri-apps/api/core";
import type { TextPart } from "@/components/HighlightedText";

export interface TagExcerpt {
  tag: string;
  /** The text around the tag's first appearance, with the tag highlighted. */
  excerpt: TextPart[] | null;
}

export interface TaggedFile {
  path: string;
  name: string;
  /** Seconds since the epoch. */
  last_modified: number;
  /** In the order they first appear in the file. */
  tags: TagExcerpt[];
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
