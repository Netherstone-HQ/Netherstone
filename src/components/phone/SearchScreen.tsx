import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftIcon,
  ClockIcon,
  FileTextIcon,
  HashIcon,
  ImageIcon,
  MicIcon,
  PinIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import type { TextPart } from "@/components/HighlightedText";
import { Button } from "@/components/ui/button";
import { flattenFiles } from "@/components/sidebar/right-sidebar/link-utils";
import type { SearchResult } from "@/lib/commands/shards";
import { getFolderInVault, isDrawingPath } from "@/lib/drawing-files";
import { countTags } from "@/lib/tags";
import { cn } from "@/lib/utils";
import { useUIStore, useVaultStore } from "@/store";
import { useTagsStore } from "@/store/tags";
import { usePhoneNav, type PhoneScreen, type SearchFilter } from "./nav";
import { openFileScreen, openFileScreenAt } from "./open-file";
import { PhoneFrame, PhoneIconButton, PhoneSection } from "./parts";
import { usePhonePrefs } from "./prefs";
import { FileRow } from "./rows";
import {
  countLine,
  inScope,
  passesFilter,
  useSearch,
} from "./search";
import { GalleryGrid, useGalleryFiles } from "./SearchGallery";
import { usePreviews } from "./usePreviews";
import { newestFirst } from "./vault-tree";

/** Tags offered on Search before anything is typed, most used first. */
const START_TAGS = 3;

type SearchEntry = Extract<PhoneScreen, { kind: "search" }>;

interface Typed {
  query: string;
  filter: SearchFilter | null;
  /** Images and voice notes: only the ones no shard uses. */
  unusedOnly: boolean;
}

// What each Search screen had typed, so Back from a result finds it again.
const typedByEntry = new WeakMap<SearchEntry, Typed>();

function useTyped(entry: SearchEntry) {
  const [typed, setTyped] = useState<Typed>(
    () =>
      typedByEntry.get(entry) ?? {
        query: "",
        filter: entry.filter ?? null,
        unusedOnly: false,
      },
  );
  useEffect(() => {
    typedByEntry.set(entry, typed);
  }, [entry, typed]);
  return [
    typed,
    (change: Partial<Typed>) => setTyped((t) => ({ ...t, ...change })),
  ] as const;
}

const FILTERS: { filter: SearchFilter; label: string; icon: ReactNode }[] = [
  { filter: { kind: "drawings" }, label: "Drawings", icon: <DrawingIcon /> },
  { filter: { kind: "images" }, label: "Images", icon: <ImageIcon /> },
  { filter: { kind: "voice" }, label: "Voice notes", icon: <MicIcon /> },
  { filter: { kind: "pinned" }, label: "Pinned", icon: <PinIcon /> },
];

function sameFilter(a: SearchFilter | null, b: SearchFilter | null) {
  if (!a || !b) return a === b;
  return (
    a.kind === b.kind && (a.kind !== "tag" || a.tag === (b as typeof a).tag)
  );
}

function filterLabel(filter: SearchFilter) {
  return filter.kind === "tag"
    ? filter.tag
    : (FILTERS.find((f) => f.filter.kind === filter.kind)?.label ?? "");
}

function filterIcon(filter: SearchFilter) {
  return filter.kind === "tag" ? (
    <HashIcon />
  ) : (
    FILTERS.find((f) => f.filter.kind === filter.kind)?.icon
  );
}

/** Search: the vault, or one folder, by words, kind, pin or tag. */
export function SearchScreen({ entry }: { entry: SearchEntry }) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const back = usePhoneNav((s) => s.back);
  const [typed, change] = useTyped(entry);
  const { query, filter } = typed;
  const inputRef = useRef<HTMLInputElement>(null);
  const folderName = entry.folder?.split(/[\\/]/).pop();
  const isStart = !query.trim() && !filter;

  return (
    <PhoneFrame>
      <div className="flex h-16 shrink-0 items-center gap-1 pr-2 pl-1">
        <PhoneIconButton label="Back" onClick={back}>
          <ArrowLeftIcon />
        </PhoneIconButton>
        <div className="flex h-12 min-w-0 flex-1 items-center rounded-3xl border bg-card">
          <input
            ref={inputRef}
            autoFocus={!typedByEntry.has(entry)}
            type="search"
            enterKeyHint="search"
            aria-label={
              folderName ? `Search in ${folderName}` : "Search this vault"
            }
            placeholder={
              folderName ? `Search in ${folderName}` : "Search this vault"
            }
            value={query}
            onChange={(event) => change({ query: event.target.value })}
            className="h-full min-w-0 flex-1 bg-transparent pl-4 outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <PhoneIconButton
              label="Clear search"
              onClick={() => {
                change({ query: "" });
                inputRef.current?.focus();
              }}
            >
              <XIcon />
            </PhoneIconButton>
          ) : null}
        </div>
      </div>

      {isStart ? (
        <SearchStart
          folder={entry.folder}
          onFilter={(next) => change({ filter: next })}
          onQuery={(next) => change({ query: next })}
        />
      ) : (
        <>
          <ChipRow typed={typed} change={change} />
          {filter?.kind === "images" || filter?.kind === "voice" ? (
            <GalleryResults
              kind={filter.kind === "images" ? "image" : "audio"}
              typed={typed}
            />
          ) : (
            <ShardResults
              typed={typed}
              folder={entry.folder}
              vaultPath={vaultPath}
              onClear={() => {
                change({ query: "" });
                inputRef.current?.focus();
              }}
            />
          )}
        </>
      )}
    </PhoneFrame>
  );
}

function Chip({
  icon,
  label,
  active = false,
  onClick,
}: {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-[15px] outline-none active:bg-accent [&_svg]:size-4.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground",
        active && "border-transparent bg-accent [&_svg]:text-foreground",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
      {active ? <XIcon aria-hidden="true" /> : null}
    </button>
  );
}

/** The filters under the field once something is typed or picked. */
function ChipRow({
  typed,
  change,
}: {
  typed: Typed;
  change: (change: Partial<Typed>) => void;
}) {
  const { filter, unusedOnly } = typed;
  const isGallery = filter?.kind === "images" || filter?.kind === "voice";
  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-3 [scrollbar-width:none]">
      {filter ? (
        <Chip
          active
          icon={filterIcon(filter)}
          label={filterLabel(filter)}
          onClick={() => change({ filter: null, unusedOnly: false })}
        />
      ) : null}
      {isGallery ? (
        <Chip
          label="Not used"
          active={unusedOnly}
          onClick={() => change({ unusedOnly: !unusedOnly })}
        />
      ) : null}
      {FILTERS.filter((f) => !sameFilter(f.filter, filter)).map((f) => (
        <Chip
          key={f.label}
          icon={f.icon}
          label={f.label}
          onClick={() => change({ filter: f.filter, unusedOnly: false })}
        />
      ))}
    </div>
  );
}

/** Before anything is typed: filters, tags and recent searches. */
function SearchStart({
  folder,
  onFilter,
  onQuery,
}: {
  folder: string | undefined;
  onFilter: (filter: SearchFilter) => void;
  onQuery: (query: string) => void;
}) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const recent = usePhonePrefs((s) =>
    vaultPath ? s.recentSearches[vaultPath] : undefined,
  );
  const tagged = useTaggedFiles();
  const tags = countTags(tagged.filter((file) => inScope(file.path, folder)));
  const push = usePhoneNav((s) => s.push);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <PhoneSection label="Show only">
        <div className="flex flex-wrap gap-2 px-4">
          {FILTERS.map((f) => (
            <Chip
              key={f.label}
              icon={f.icon}
              label={f.label}
              onClick={() => onFilter(f.filter)}
            />
          ))}
        </div>
      </PhoneSection>
      {tags.length > 0 ? (
        <PhoneSection label="Tags">
          <div className="flex flex-wrap gap-2 px-4">
            {tags.slice(0, START_TAGS).map(({ tag }) => (
              <Chip
                key={tag}
                icon={<HashIcon />}
                label={tag}
                onClick={() => onFilter({ kind: "tag", tag })}
              />
            ))}
            <Chip label="All tags" onClick={() => push({ kind: "tags" })} />
          </div>
        </PhoneSection>
      ) : null}
      {recent?.length ? (
        <PhoneSection label="Recent searches">
          {recent.map((query) => (
            <button
              key={query}
              type="button"
              className="flex h-13 w-full items-center gap-3 px-4 text-left outline-none active:bg-accent"
              onClick={() => onQuery(query)}
            >
              <ClockIcon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{query}</span>
            </button>
          ))}
        </PhoneSection>
      ) : null}
    </div>
  );
}

/** Every tagged shard in the vault, loaded when the index changes. */
export function useTaggedFiles() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const files = useTagsStore((s) => s.files);
  const isStale = useTagsStore((s) => s.isStale);
  const load = useTagsStore((s) => s.load);
  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, isStale, load]);
  return files;
}

/** Words found in a result, in the brand colour. */
function Found({ parts }: { parts: TextPart[] }) {
  return parts.map((part, at) =>
    part.highlight ? (
      <strong key={at} className="font-semibold text-brand">
        {part.text}
      </strong>
    ) : (
      <span key={at}>{part.text}</span>
    ),
  );
}

function ResultRow({
  result,
  vaultPath,
  onOpen,
}: {
  result: SearchResult;
  vaultPath: string;
  onOpen: () => void;
}) {
  const Icon = isDrawingPath(result.path) ? DrawingIcon : FileTextIcon;
  const folder = getFolderInVault(result.path, vaultPath);
  return (
    <button
      type="button"
      className="flex w-full flex-col gap-1 px-4 py-3 text-left outline-none active:bg-accent"
      onClick={onOpen}
    >
      <span className="flex w-full min-w-0 items-center gap-3">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">
          <Found parts={result.title} />
        </span>
      </span>
      {folder ? (
        <span className="truncate pl-8 text-sm text-muted-foreground">
          {folder}
        </span>
      ) : null}
      {result.snippet.length > 0 ? (
        <span className="line-clamp-2 pl-8 font-reading text-[15px] leading-6 text-muted-foreground">
          <Found parts={result.snippet} />
        </span>
      ) : isDrawingPath(result.path) ? (
        <span className="pl-8 font-reading text-[15px] text-muted-foreground">
          Drawing
        </span>
      ) : null}
    </button>
  );
}

/** Shards and drawings: found by words, or listed by the filter alone. */
function ShardResults({
  typed,
  folder,
  vaultPath,
  onClear,
}: {
  typed: Typed;
  folder: string | undefined;
  vaultPath: string | null;
  onClear: () => void;
}) {
  const { query, filter } = typed;
  const search = useSearch(query);
  const pinned = useUIStore((s) => s.pinnedFiles);
  const fileTree = useVaultStore((s) => s.fileTree);
  const tagged = useTaggedFiles();
  const addRecentSearch = usePhonePrefs((s) => s.addRecentSearch);
  const taggedHere =
    filter?.kind === "tag"
      ? tagged.filter((file) => file.tags.some(({ tag }) => tag === filter.tag))
      : [];
  const keep = (path: string) =>
    inScope(path, folder) && passesFilter(path, filter, pinned, taggedHere);

  // With a filter and nothing typed: everything the filter picks.
  const listed = !query.trim()
    ? filter?.kind === "pinned"
      ? pinned.map((file) => file.path)
      : filter?.kind === "tag"
        ? taggedHere.map((file) => file.path)
        : flattenFiles(fileTree).map((file) => file.path)
    : [];
  const listedPaths = listed.filter(keep);
  const previews = usePreviews(filter?.kind === "drawings" ? listedPaths : []);

  if (!vaultPath) return null;

  if (!query.trim()) {
    const paths =
      filter?.kind === "drawings"
        ? newestFirst(
            listedPaths.map((path) => ({ path })),
            (path) => previews.get(path)?.lastModified,
          ).map((file) => file.path)
        : listedPaths;
    return (
      <List count={countLine(paths)}>
        {paths.length === 0 ? (
          <Nothing text={`No ${filterLabel(filter!).toLowerCase()} here yet`} />
        ) : (
          paths.map((path) =>
            filter?.kind === "tag" ? (
              <FileRow
                key={path}
                path={path}
                detail={getFolderInVault(path, vaultPath)}
                preview={undefined}
                onOpen={() => openFileScreenAt({ path, tag: filter.tag })}
              />
            ) : (
              <FileRow
                key={path}
                path={path}
                detail={getFolderInVault(path, vaultPath)}
                preview={previews.get(path)}
              />
            ),
          )
        )}
      </List>
    );
  }

  if (search.status === "failed") {
    return <Nothing text="Search couldn't finish. Your shards are fine." />;
  }
  if (search.status !== "done") return <div className="flex-1" />;

  const results = search.results.filter((result) => keep(result.path));
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 px-4 pt-20 text-center">
        <SearchIcon className="size-7 text-muted-foreground" />
        <p className="text-lg font-semibold">
          No shards match “{search.query}”
        </p>
        <Button
          variant="outline"
          className="h-11 px-4.5 text-base"
          onClick={onClear}
        >
          Clear search
        </Button>
      </div>
    );
  }

  return (
    <List count={countLine(results.map((r) => r.path))}>
      {results.map((result) => (
        <ResultRow
          key={result.path}
          result={result}
          vaultPath={vaultPath}
          onOpen={() => {
            addRecentSearch(vaultPath, search.query);
            void openFileScreen(result.path).catch((error: unknown) =>
              console.error("[Netherstone] Couldn't open the result:", error),
            );
          }}
        />
      ))}
    </List>
  );
}

function List({ count, children }: { count: string; children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      {count ? (
        <p className="px-4 pb-2 text-sm text-muted-foreground">{count}</p>
      ) : null}
      {children}
    </div>
  );
}

function Nothing({ text }: { text: string }) {
  return <p className="px-4 pt-20 text-center text-muted-foreground">{text}</p>;
}

/** Images or voice notes, as tiles. */
function GalleryResults({
  kind,
  typed,
}: {
  kind: "image" | "audio";
  typed: Typed;
}) {
  const { status, files } = useGalleryFiles(
    kind,
    typed.query,
    typed.unusedOnly,
  );
  const noun = kind === "image" ? "image" : "voice note";
  if (status === "error") return <Nothing text="Files couldn't be loaded." />;
  if (status !== "ready") return <div className="flex-1" />;
  if (files.length === 0) {
    return (
      <Nothing
        text={
          typed.query.trim()
            ? `No ${noun}s match “${typed.query.trim()}”`
            : `No ${noun}s here yet`
        }
      />
    );
  }
  return (
    <>
      <p className="shrink-0 px-4 pb-2 text-sm text-muted-foreground">
        {files.length} {files.length === 1 ? noun : `${noun}s`}
      </p>
      <GalleryGrid files={files} />
    </>
  );
}
