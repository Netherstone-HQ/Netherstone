import { useEffect, useState } from "react";
import { searchFiles, type SearchResult } from "@/lib/commands/shards";
import { isDrawingPath, isPathWithin, isSamePath } from "@/lib/drawing-files";
import type { SearchFilter } from "./nav";

/** How long typing pauses before Search runs. */
const SEARCH_DELAY_MS = 300;
/** Results asked for; filters and folders pick from these. */
const SEARCH_LIMIT = 50;

export type SearchState =
  | { status: "idle" }
  | { status: "searching"; query: string }
  | { status: "done"; query: string; results: SearchResult[] }
  | { status: "failed"; query: string };

/** Searches the vault for `query` once typing pauses. */
export function useSearch(query: string): SearchState {
  const [state, setState] = useState<SearchState>({ status: "idle" });
  const trimmed = query.trim();

  useEffect(() => {
    if (!trimmed) {
      setState({ status: "idle" });
      return;
    }
    let isCurrent = true;
    setState((prev) =>
      prev.status === "done" ? prev : { status: "searching", query: trimmed },
    );
    const timer = setTimeout(() => {
      searchFiles(trimmed, SEARCH_LIMIT)
        .then((results) => {
          if (isCurrent) setState({ status: "done", query: trimmed, results });
        })
        .catch((error: unknown) => {
          console.error("[Netherstone] Search failed:", error);
          if (isCurrent) setState({ status: "failed", query: trimmed });
        });
    }, SEARCH_DELAY_MS);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [trimmed]);

  return state;
}

/** Whether `path` passes `filter`, given the pinned and tagged paths. */
export function passesFilter(
  path: string,
  filter: SearchFilter | null,
  pinned: { path: string }[],
  tagged: { path: string }[],
) {
  if (!filter) return true;
  const inList = (list: { path: string }[]) =>
    list.some((entry) => isSamePath(entry.path, path));
  switch (filter.kind) {
    case "drawings":
      return isDrawingPath(path);
    case "pinned":
      return inList(pinned);
    case "tag":
      return inList(tagged);
    default:
      return false;
  }
}

/** Whether `path` is in `folder`, or anywhere when there's no folder. */
export function inScope(path: string, folder: string | undefined) {
  return !folder || isPathWithin(path, folder);
}

/** "3 shards, 1 drawing". */
export function countLine(paths: string[]) {
  const drawings = paths.filter(isDrawingPath).length;
  const shards = paths.length - drawings;
  const parts = [];
  if (shards > 0) parts.push(`${shards} ${shards === 1 ? "shard" : "shards"}`);
  if (drawings > 0) {
    parts.push(`${drawings} ${drawings === 1 ? "drawing" : "drawings"}`);
  }
  return parts.join(", ");
}
