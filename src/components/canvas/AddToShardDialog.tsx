import { useMemo, useState } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { toast } from "sonner";

import { flattenShardFiles } from "@/components/sidebar/right-sidebar/link-utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addDrawingToShard,
  getDrawingAltText,
  type ExportableScene,
} from "@/lib/drawing-exports";
import {
  getFolderInVault,
  getVaultFileDisplayName,
  isSamePath,
} from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { useUIStore, useVaultStore } from "@/store";
import type { FileTreeNode } from "@/store";
import type { RecentFileEntry } from "@/store/ui";

/**
 * Whether `scene` has something to add to a shard. Says so when it hasn't.
 */
export function hasSomethingToAdd(scene: ExportableScene) {
  if (scene.elements.some((element) => !element.isDeleted)) return true;
  toast("Draw something first, then add it to a shard.");
  return false;
}

/** Enough to pick from; typing narrows a longer list. */
const MAX_SHOWN_SHARDS = 100;

/** The vault's shards, the recently opened ones first, then by name. */
function sortShards(fileTree: FileTreeNode[], recentFiles: RecentFileEntry[]) {
  const recentIndex = (path: string) => {
    const index = recentFiles.findIndex((entry) =>
      isSamePath(entry.path, path),
    );
    return index === -1 ? recentFiles.length : index;
  };

  return flattenShardFiles(fileTree)
    .map((node) => ({
      path: node.path,
      name: getVaultFileDisplayName(node.name),
      recentIndex: recentIndex(node.path),
    }))
    .sort(
      (a, b) =>
        a.recentIndex - b.recentIndex ||
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
}

/**
 * Adds an image of the open drawing to a shard the user finds by name. The
 * image stays linked to the drawing, so it updates when the drawing changes.
 */
export function AddToShardDialog({
  open,
  onOpenChange,
  drawingPath,
  getScene,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drawingPath: string;
  getScene: () => ExportableScene;
}) {
  const fileTree = useVaultStore((s) => s.fileTree);
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const recentFiles = useUIStore((s) => s.recentFiles);
  const [query, setQuery] = useState("");
  const [shardPath, setShardPath] = useState("");
  const [includeBackground, setIncludeBackground] = useState(true);
  const [isAdding, setIsAdding] = useState(false);

  const drawingName = getDrawingAltText(drawingPath);
  const shards = useMemo(
    () => (open ? sortShards(fileTree, recentFiles) : []),
    [open, fileTree, recentFiles],
  );
  const shownShards = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return shards
      .filter((shard) =>
        words.every((word) => shard.name.toLowerCase().includes(word)),
      )
      .slice(0, MAX_SHOWN_SHARDS);
  }, [shards, query]);

  const isShardPicked = shownShards.some((shard) => shard.path === shardPath);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isAdding) return;
    onOpenChange(nextOpen);
    if (!nextOpen) setQuery("");
  };

  const add = async () => {
    const shard = shownShards.find((option) => option.path === shardPath);
    if (!shard || !vaultPath || isAdding) return;

    const scene = getScene();
    setIsAdding(true);
    try {
      const result = await addDrawingToShard(
        {
          ...scene,
          appState: { ...scene.appState, exportBackground: includeBackground },
        },
        drawingPath,
        shard.path,
        vaultPath,
      );
      toast.success(
        result === "added"
          ? `Added ${drawingName} to ${shard.name}`
          : `Updated ${drawingName} in ${shard.name}`,
        {
          action: {
            label: "Open shard",
            onClick: () => void openVaultFile(shard.path),
          },
        },
      );
      onOpenChange(false);
      setQuery("");
    } catch (error) {
      console.error("[Netherstone] Failed to add drawing to shard:", error);
      toast.error(`Couldn't add ${drawingName} to ${shard.name}`, {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="gap-4 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {drawingName} to a shard</DialogTitle>
          <DialogDescription>
            The image updates in the shard when you change the drawing.
          </DialogDescription>
        </DialogHeader>

        {/* The highlighted shard is the one picked: the arrow keys or a
            click move it, and Enter adds the drawing there. */}
        <Command
          shouldFilter={false}
          disablePointerSelection
          value={shardPath}
          onValueChange={setShardPath}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void add();
            }
          }}
          className="gap-2 overflow-visible rounded-none! bg-transparent p-0"
        >
          <label className="flex h-9 items-center gap-2 rounded-md border border-input px-2.5 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <CommandPrimitive.Input
              placeholder="Find a shard"
              value={query}
              onValueChange={setQuery}
              autoFocus
              className="h-full min-w-0 flex-1 bg-transparent text-ui outline-none placeholder:text-muted-foreground"
            />
          </label>
          <CommandList className="max-h-64">
            <CommandEmpty className="py-4 text-ui-sm text-muted-foreground">
              {query
                ? `No shards match “${query}”.`
                : "This vault has no shards yet."}
            </CommandEmpty>
            {shownShards.map((shard) => {
              const folder = vaultPath
                ? getFolderInVault(shard.path, vaultPath)
                : "";
              return (
                <CommandItem
                  key={shard.path}
                  value={shard.path}
                  data-checked={shard.path === shardPath}
                  className="h-row cursor-pointer gap-2 px-2 py-0 text-sidebar-foreground/85 hover:bg-accent/40 data-selected:bg-accent data-selected:text-accent-foreground in-data-[slot=dialog-content]:rounded-sm!"
                >
                  <span className="min-w-0 flex-1 truncate">{shard.name}</span>
                  {folder ? (
                    <span className="max-w-[40%] shrink-0 truncate text-ui-sm text-muted-foreground">
                      {folder}
                    </span>
                  ) : null}
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>

        <DialogFooter className="sm:items-center sm:justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-ui">
            <Checkbox
              checked={includeBackground}
              onCheckedChange={(checked) =>
                setIncludeBackground(checked === true)
              }
            />
            Include background
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isAdding}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void add()}
              disabled={!isShardPicked || isAdding}
            >
              {isAdding ? "Adding…" : "Add to shard"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
