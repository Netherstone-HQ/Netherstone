import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CornerDownLeftIcon,
  FileIcon,
  HistoryIcon,
  LoaderCircleIcon,
  SearchIcon,
  SearchXIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  getFolderInVault,
  getVaultFileDisplayName,
  isDrawingPath,
  isPathWithin,
} from "@/lib/drawing-files";
import { openFileHistory, openVaultFile } from "@/lib/open-vault-file";
import { fileName } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { HighlightedText, type TextPart } from "./HighlightedText";

interface SearchResult {
  path: string;
  name: string;
  /** The text around the words searched for, which are highlighted. */
  snippet: TextPart[];
  rank: number;
}

/** A row in the list: a search result, or a recent file before any search. */
interface Row {
  path: string;
  name: TextPart[];
  snippet?: TextPart[];
  /** Shows the file's history instead of opening it. */
  isHistory?: boolean;
}

/** Words that find "Show history" for the open file. */
const HISTORY_WORDS = ["show", "history", "versions", "restore"];

/** True when every word typed starts a word of "Show history" and friends. */
function asksForHistory(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (
    query.trim().length >= 3 &&
    words.every((word) => HISTORY_WORDS.some((known) => known.startsWith(word)))
  );
}

/** What the dialog says when a search fails, by the reason the backend gives. */
const SEARCH_ERRORS = {
  unavailable: {
    title: "Couldn't open the search index",
    description: "Restart Netherstone and try again.",
  },
  failed: {
    title: "Search couldn't finish",
    description: "Your shards are fine. Only the search hit a problem.",
  },
};

type SearchError = keyof typeof SEARCH_ERRORS;

const MAX_RECENT = 5;

/**
 * The words of a search as the backend splits them (`search_terms` in
 * `db/queries.rs`), so a name is highlighted where the search matched it.
 */
function searchTerms(query: string) {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const isLetter = (word: string) => [...word].length === 1;
  return words.every(isLetter) ? words : words.filter((w) => !isLetter(w));
}

/**
 * `text` with each word that starts with a searched word highlighted, as
 * `word_matches` does for snippets.
 */
function highlightWords(text: string, terms: string[]): TextPart[] {
  if (terms.length === 0) return [{ text, highlight: false }];
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})[\\p{L}\\p{N}]*`,
    "giu",
  );

  const parts: TextPart[] = [];
  const plain = (from: number, to?: number) => {
    if (to === undefined || to > from) {
      parts.push({ text: text.slice(from, to), highlight: false });
    }
  };
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    plain(last, start);
    parts.push({ text: match[0], highlight: true });
    last = start + match[0].length;
  }
  if (last < text.length) plain(last);
  return parts;
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-muted px-1.5 font-mono text-[11px] leading-[18px]">
      {children}
    </kbd>
  );
}

/** A message in place of the list, such as "No shards match". */
function Notice({
  icon: Icon,
  tone = "muted",
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  tone?: "muted" | "error";
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className="flex flex-col items-center gap-1.5 px-6 py-10 text-center"
    >
      <Icon
        className={cn(
          "mb-1.5 size-5",
          tone === "error" ? "text-destructive" : "text-muted-foreground",
        )}
      />
      <p className="font-medium text-ui">{title}</p>
      <p className="text-muted-foreground text-ui-sm">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

interface SearchModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SearchModal({ open, onOpenChange }: SearchModalProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<SearchError | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const recentFiles = useUIStore((s) => s.recentFiles);
  const isCanvas = useUIStore((s) => s.appMode === "canvas");
  const drawingPath = useUIStore((s) => s.activeDrawingPath);
  const shardPath = useEditorStore((s) => s.currentFilePath);
  const openFilePath = isCanvas ? drawingPath : shardPath;
  // Answers can arrive out of order; only the latest search's counts.
  const searchIdRef = useRef(0);

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setSearchError(null);
      setSelectedIndex(0);
    }
  }, [open]);

  const performSearch = useCallback(async (searchQuery: string) => {
    const id = ++searchIdRef.current;
    if (searchQuery.trim().length === 0) {
      setResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    try {
      const searchResults = await invoke<SearchResult[]>("search_files", {
        query: searchQuery,
        limit: 20,
      });
      if (id !== searchIdRef.current) return;
      setResults(searchResults);
      setSearchError(null);
      setSelectedIndex(0);
    } catch (error) {
      if (id !== searchIdRef.current) return;
      console.error("Search failed:", error);
      setResults([]);
      setSearchError(error === "unavailable" ? "unavailable" : "failed");
    } finally {
      if (id === searchIdRef.current) setIsSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      void performSearch(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query, performSearch]);

  const hasQuery = query.trim().length > 0;
  const terms = searchTerms(query);
  const historyRows: Row[] =
    hasQuery && openFilePath && asksForHistory(query)
      ? [
          {
            path: openFilePath,
            name: [{ text: "Show history", highlight: false }],
            isHistory: true,
          },
        ]
      : [];
  const rows: Row[] = hasQuery
    ? historyRows.concat(
        results.map((result) => ({
        path: result.path,
        name: highlightWords(getVaultFileDisplayName(result.name), terms),
          snippet: result.snippet,
        })),
      )
    : recentFiles
        .filter(
          (file) =>
            currentVaultPath !== null &&
            isPathWithin(file.path, currentVaultPath),
        )
        .slice(0, MAX_RECENT)
        .map((file) => ({
          path: file.path,
          name: [
            { text: getVaultFileDisplayName(file.name), highlight: false },
          ],
        }));

  const handleSelect = async (row: Row) => {
    try {
      await (row.isHistory ? openFileHistory : openVaultFile)(row.path);
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to open file:", error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && rows[selectedIndex]) {
      e.preventDefault();
      void handleSelect(rows[selectedIndex]);
    }
  };

  let body: React.ReactNode;
  if (searchError) {
    const { title, description } = SEARCH_ERRORS[searchError];
    body = (
      <Notice
        icon={TriangleAlertIcon}
        tone="error"
        title={title}
        description={description}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void performSearch(query)}
          >
            Try again
          </Button>
        }
      />
    );
  } else if (hasQuery && rows.length === 0 && !isSearching) {
    body = (
      <Notice
        icon={SearchXIcon}
        title={`No shards match “${query.trim()}”`}
        description="Try fewer words, or check the spelling."
      />
    );
  } else if (rows.length > 0) {
    body = (
      <div className="flex flex-col gap-0.5 p-1.5">
        {!hasQuery ? (
          <p className="px-2.5 pt-2 pb-1 font-medium text-muted-foreground text-ui-sm">
            Recent
          </p>
        ) : null}
        {rows.map((row, index) => {
          const selected = index === selectedIndex;
          // For "Show history", the file it's for.
          const folder = row.isHistory
            ? getVaultFileDisplayName(fileName(row.path))
            : currentVaultPath
              ? getFolderInVault(row.path, currentVaultPath)
              : "";
          const Icon = row.isHistory
            ? HistoryIcon
            : isDrawingPath(row.path)
              ? DrawingIcon
              : FileIcon;
          return (
            <button
              key={row.isHistory ? `history:${row.path}` : row.path}
              type="button"
              onClick={() => void handleSelect(row)}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                "flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left outline-none",
                selected && "bg-accent",
              )}
            >
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate font-medium text-ui">
                    <HighlightedText parts={row.name} />
                  </span>
                  {folder ? (
                    <span className="truncate text-muted-foreground text-ui-sm">
                      {folder}
                    </span>
                  ) : null}
                </span>
                {row.snippet && row.snippet.length > 0 ? (
                  <span className="truncate text-muted-foreground text-ui-sm">
                    <HighlightedText parts={row.snippet} />
                  </span>
                ) : null}
              </span>
              {selected ? (
                <CornerDownLeftIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 self-center text-muted-foreground"
                />
              ) : null}
            </button>
          );
        })}
      </div>
    );
  } else if (!hasQuery) {
    body = (
      <p className="px-6 py-10 text-center text-muted-foreground text-ui-sm">
        Search shard names and text across your vault.
      </p>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-160"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">
          Search shard names and text across your vault.
        </DialogDescription>

        <label className="flex h-13 items-center gap-2.5 border-b pr-3.5 pl-4">
          {isSearching ? (
            <LoaderCircleIcon className="size-4.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <SearchIcon className="size-4.5 shrink-0 text-muted-foreground" />
          )}
          <span className="sr-only">Search your vault</span>
          <input
            placeholder="Search your vault"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="h-full min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-muted-foreground"
            autoFocus
          />
          <kbd className="rounded bg-muted px-1.5 font-mono text-muted-foreground text-xs leading-5">
            Esc
          </kbd>
        </label>

        <div className="max-h-100 overflow-y-auto">{body}</div>

        {rows.length > 0 ? (
          <div className="flex h-9 items-center justify-between border-t px-3.5 text-muted-foreground text-xs">
            <div className="flex items-center gap-3.5">
              <span className="flex items-center gap-1.5">
                <Kbd>↑↓</Kbd>Move
              </span>
              <span className="flex items-center gap-1.5">
                <Kbd>↵</Kbd>Open
              </span>
            </div>
            {hasQuery ? (
              <span className="font-mono">
                {results.length} {results.length === 1 ? "shard" : "shards"}
              </span>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
