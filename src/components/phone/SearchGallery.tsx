import { useEffect, useRef, useState } from "react";
import { FileTextIcon } from "lucide-react";
import { Thumbnail, useNearView } from "@/components/gallery/GalleryView";
import { BottomSheet, BottomSheetItem } from "@/components/ui/bottom-sheet";
import { fileName, getVaultFileDisplayName } from "@/lib/drawing-files";
import {
  matchesFileFilter,
  type GalleryFile,
  type GalleryKind,
} from "@/lib/gallery";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/store";
import { useGalleryStore } from "@/store/gallery";
import { openFileScreenAt } from "./open-file";

/** The vault's files of `kind`, by name, as a grid of tiles. */
export function useGalleryFiles(
  kind: GalleryKind,
  query: string,
  unusedOnly: boolean,
) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const files = useGalleryStore((s) => s.files);
  const status = useGalleryStore((s) => s.status);
  const isStale = useGalleryStore((s) => s.isStale);
  const load = useGalleryStore((s) => s.load);

  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, isStale, load]);

  return {
    status,
    files: files.filter(
      (file) =>
        file.kind === kind &&
        matchesFileFilter(file, query) &&
        (!unusedOnly || file.shardPaths.length === 0),
    ),
  };
}

function shardName(path: string) {
  return getVaultFileDisplayName(fileName(path));
}

function open(file: GalleryFile, shardPath: string) {
  void openFileScreenAt({ path: shardPath, assetPath: file.assetPath }).catch(
    (error: unknown) =>
      console.error("[Netherstone] Couldn't open the shard:", error),
  );
}

/**
 * Tiles three across. A file one shard uses opens that shard at it; one
 * several shards use lists them to pick from.
 */
export function GalleryGrid({ files }: { files: GalleryFile[] }) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState<GalleryFile | null>(null);
  if (!vaultPath) return null;

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4"
    >
      <ul className="grid grid-cols-3 gap-2">
        {files.map((file) => (
          <Tile
            key={file.assetPath}
            file={file}
            vaultPath={vaultPath}
            scrollRoot={scrollRef}
            onOpen={() =>
              file.shardPaths.length === 1
                ? open(file, file.shardPaths[0])
                : setPicking(file)
            }
          />
        ))}
      </ul>
      <BottomSheet
        open={picking !== null}
        onOpenChange={(next) => (next ? null : setPicking(null))}
        title="Used in"
      >
        {picking?.shardPaths.map((path) => (
          <BottomSheetItem
            key={path}
            icon={<FileTextIcon />}
            onClick={() => {
              setPicking(null);
              open(picking, path);
            }}
          >
            {shardName(path)}
          </BottomSheetItem>
        ))}
      </BottomSheet>
    </div>
  );
}

function Tile({
  file,
  vaultPath,
  scrollRoot,
  onOpen,
}: {
  file: GalleryFile;
  vaultPath: string;
  scrollRoot: React.RefObject<HTMLDivElement | null>;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const isNear = useNearView(ref, scrollRoot);
  const unused = file.shardPaths.length === 0;
  return (
    <li>
      <button
        ref={ref}
        type="button"
        disabled={unused}
        aria-label={unused ? `${file.name}, not used` : file.name}
        className={cn(
          "relative flex aspect-square w-full overflow-hidden rounded-lg border bg-card outline-none",
          !unused && "active:opacity-80",
        )}
        onClick={onOpen}
      >
        <Thumbnail file={file} vaultPath={vaultPath} isNear={isNear} />
        <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-card px-2 pt-4 pb-2 text-left text-xs text-muted-foreground">
          {file.name}
        </span>
      </button>
    </li>
  );
}
