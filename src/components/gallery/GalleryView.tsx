import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileTextIcon, ImagesIcon } from "lucide-react";

import { NextPageTrigger } from "@/components/NextPageTrigger";
import { LeftSidebarToggle } from "@/components/PanelToggles";
import { openShardAt } from "@/components/data/rows";
import { formatBytes, getFileName } from "@/components/settings/attachment-format";
import { useThemeMode } from "@/components/theme/theme-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  getVaultFileDisplayName,
  resolveVaultRelativePath,
} from "@/lib/drawing-files";
import {
  filesInRow,
  getRowTitle,
  matchesFileFilter,
  type GalleryFile,
} from "@/lib/gallery";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/store";
import { selectActiveRow, useGalleryStore } from "@/store/gallery";
import { KIND_ICONS } from "./kind-icons";

const TILE_CLASS =
  "flex w-full flex-col overflow-hidden rounded-lg border bg-card text-left outline-none transition-colors";
const OPENABLE_TILE_CLASS = cn(
  TILE_CLASS,
  "hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-accent/40",
);

function shardName(shardPath: string) {
  return getVaultFileDisplayName(getFileName(shardPath));
}

function usedIn(file: GalleryFile) {
  const count = file.shardPaths.length;
  if (count === 0) return "Not used";
  if (count === 1) return `in ${shardName(file.shardPaths[0])}`;
  return `in ${count} shards`;
}

/** A separator drawn as a dot. */
function Dot() {
  return (
    <span
      aria-hidden="true"
      className="mx-1.5 inline-block size-[3px] translate-y-[-2px] rounded-full bg-muted-foreground/70 align-middle"
    />
  );
}

function Thumbnail({
  file,
  vaultPath,
}: {
  file: GalleryFile;
  vaultPath: string;
}) {
  const isDark = useThemeMode() === "dark";

  if (file.kind === "image" || file.kind === "drawing") {
    const assetPath =
      isDark && file.darkAssetPath ? file.darkAssetPath : file.assetPath;
    return (
      <img
        src={convertFileSrc(resolveVaultRelativePath(assetPath, vaultPath))}
        alt=""
        loading="lazy"
        decoding="async"
        className={cn(
          "size-full",
          file.kind === "drawing" ? "object-contain p-3" : "object-cover",
        )}
      />
    );
  }

  const Icon = KIND_ICONS[file.kind];
  const extension = file.name.includes(".")
    ? file.name.split(".").pop()?.toUpperCase()
    : null;
  return (
    <div className="flex size-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
      <Icon className="size-8" strokeWidth={1.5} />
      {extension ? <span className="text-ui-sm">{extension}</span> : null}
    </div>
  );
}

function TileBody({
  file,
  vaultPath,
}: {
  file: GalleryFile;
  vaultPath: string;
}) {
  return (
    <>
      <div className="aspect-[4/3] w-full overflow-hidden border-b bg-muted/40">
        <Thumbnail file={file} vaultPath={vaultPath} />
      </div>
      <div className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2">
        <span className="truncate font-medium text-ui">{file.name}</span>
        <span className="truncate text-muted-foreground text-ui-sm">
          {usedIn(file)}
        </span>
      </div>
    </>
  );
}

/**
 * One file. A file one shard uses opens that shard at it; several shards
 * are listed to pick from.
 */
function Tile({ file, vaultPath }: { file: GalleryFile; vaultPath: string }) {
  const { assetPath, shardPaths } = file;
  const body = <TileBody file={file} vaultPath={vaultPath} />;

  if (shardPaths.length === 0) {
    return (
      <li title={file.name} className={TILE_CLASS}>
        {body}
      </li>
    );
  }

  if (shardPaths.length === 1) {
    return (
      <li>
        <button
          type="button"
          title={file.name}
          className={OPENABLE_TILE_CLASS}
          onClick={() => void openShardAt({ path: shardPaths[0], assetPath })}
        >
          {body}
        </button>
      </li>
    );
  }

  return (
    <li>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={file.name}
            className={OPENABLE_TILE_CLASS}
          >
            {body}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="start" className="w-64">
          <DropdownMenuLabel className="font-normal text-muted-foreground text-ui-sm">
            Used in
          </DropdownMenuLabel>
          {shardPaths.map((shardPath) => (
            <DropdownMenuItem
              key={shardPath}
              onSelect={() => void openShardAt({ path: shardPath, assetPath })}
            >
              <FileTextIcon className="text-muted-foreground" />
              <span className="min-w-0 truncate">{shardName(shardPath)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function NoAttachmentsYet() {
  return (
    <div className="mx-auto mt-24 flex max-w-96 flex-col items-center gap-2.5 text-center">
      <ImagesIcon className="size-7 text-muted-foreground" />
      <h2 className="font-semibold text-lg">No attachments yet</h2>
    </div>
  );
}

/** Tiles drawn at a time; more appear as you scroll. */
const PAGE_SIZE = 60;

/** The Gallery's main area: the vault's attachments in the picked row. */
export function GalleryView() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const files = useGalleryStore((s) => s.files);
  const status = useGalleryStore((s) => s.status);
  const isStale = useGalleryStore((s) => s.isStale);
  const filter = useGalleryStore((s) => s.filter);
  const activeRow = useGalleryStore(selectActiveRow);
  const load = useGalleryStore((s) => s.load);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState({ row: activeRow, filter, count: PAGE_SIZE });

  // Loads on each visit if the files changed since, and again if they
  // change while the Gallery is open.
  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, isStale, load]);

  // Another row or filter starts again from the top, one page in.
  if (page.row !== activeRow || page.filter !== filter) {
    setPage({ row: activeRow, filter, count: PAGE_SIZE });
  }
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeRow, filter]);

  const showNextPage = useCallback(
    () => setPage((p) => ({ ...p, count: p.count + PAGE_SIZE })),
    [],
  );

  const results = filesInRow(files, activeRow).filter((file) =>
    matchesFileFilter(file, filter),
  );
  const shown = results.slice(0, page.count);
  const totalBytes = results.reduce((sum, file) => sum + file.sizeBytes, 0);

  let content: React.ReactNode = null;
  if (status === "error") {
    content = (
      <p className="mt-24 text-center text-muted-foreground text-ui">
        Attachments couldn't be loaded.
      </p>
    );
  } else if (status === "ready" && vaultPath) {
    content =
      files.length === 0 ? (
        <NoAttachmentsYet />
      ) : (
        <>
          <h1 className="font-semibold text-2xl tracking-tight">
            {getRowTitle(activeRow)}
          </h1>
          <p className="mt-1 mb-5 text-muted-foreground text-ui-sm">
            {results.length} {results.length === 1 ? "file" : "files"}
            <Dot />
            {formatBytes(totalBytes)}
          </p>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(184px,1fr))] gap-3">
            {shown.map((file) => (
              <Tile key={file.assetPath} file={file} vaultPath={vaultPath} />
            ))}
            {shown.length < results.length ? (
              // Keyed by the count so each page observes afresh, in case the
              // trigger is still in view after the last one.
              <NextPageTrigger
                key={shown.length}
                scrollRoot={scrollRef}
                onReach={showNextPage}
                className="col-span-full"
              />
            ) : null}
          </ul>
        </>
      );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-header shrink-0 items-center gap-1.5 border-b px-2.5">
        <LeftSidebarToggle />
        <Separator
          orientation="vertical"
          className="mx-1 h-4 data-vertical:self-center"
        />
        <span className="px-1.5 font-medium text-ui">Gallery</span>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-280">{content}</div>
      </div>
    </div>
  );
}
