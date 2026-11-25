import { useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  FileIcon,
  FileTextIcon,
  FolderIcon,
  ImageIcon,
  LinkIcon,
  SearchIcon,
} from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { flattenFiles } from "@/components/sidebar/right-sidebar/link-utils";
import {
  displayNameOf,
  getVaultFileDisplayName,
  isMarkdownPath,
  isPathWithin,
  isSamePath,
} from "@/lib/drawing-files";
import { folderName } from "@/lib/open-vault";
import { cn } from "@/lib/utils";
import { useEditorStore, useUIStore, useVaultStore, type FileTreeNode } from "@/store";
import { reportFailure } from "./toasts";
import { usePhoneNav, usePhoneScreen } from "./nav";
import { openFileScreen } from "./open-file";
import {
  saveShare,
  shareContent,
  useShareIn,
  type ShareContent,
} from "./share-in";

/** How many shards the shard list shows before a search narrows it. */
const SHARDS_SHOWN = 50;

type Where = "new" | "add";

/** "photo.jpg", "photo.jpg and notes.pdf", or "3 files". */
function filesLabel(names: string[]) {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} files`;
}

/** What the sheet shows of the share: its icon, a name and a line under it. */
function preview(content: ShareContent) {
  if (content.link)
    return { icon: <LinkIcon />, name: content.link.title, detail: content.link.site };
  if (content.text) {
    const lines = content.text.split("\n");
    return {
      icon: <FileTextIcon />,
      name: lines[0],
      detail: lines.length > 1 ? `${lines.length} lines` : null,
    };
  }
  const names = content.files.map((file) => file.name);
  const pictures = content.files.every((file) => file.type.startsWith("image/"));
  return {
    icon: pictures ? <ImageIcon /> : <FileIcon />,
    name: filesLabel(names),
    detail: null,
  };
}

/** Every folder in `tree`, with how deep it is. */
function foldersOf(tree: FileTreeNode[], depth = 0): { node: FileTreeNode; depth: number }[] {
  return tree
    .filter((node) => node.kind === "directory")
    .flatMap((node) => [{ node, depth }, ...foldersOf(node.children ?? [], depth + 1)]);
}

function closeShareIn() {
  usePhoneNav.getState().closeFrom("share-in");
}

/**
 * "Save to Netherstone": what another app shared, saved as a new shard in a
 * folder or added to the end of a shard, which then opens.
 */
export function ShareInSheet() {
  const top = usePhoneNav((s) => s.entries.at(-1));
  const open = top?.kind === "share-in" || top?.kind === "share-place";
  const choosing = top?.kind === "share-place" ? top.choose : null;
  const shared = useShareIn((s) => s.shared);
  const id = useShareIn((s) => s.id);
  const content = useMemo(() => (shared ? shareContent(shared) : null), [shared]);

  return (
    <BottomSheet
      open={open && !!content}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeShareIn();
      }}
      height={choosing ? "full" : "auto"}
      title={
        <span className="flex items-center gap-1 text-lg leading-6 font-semibold text-foreground">
          {choosing ? (
            <button
              type="button"
              aria-label="Back"
              className="-ml-3 flex size-11 items-center justify-center rounded-full active:bg-accent [&_svg]:size-5"
              onClick={() => usePhoneNav.getState().back()}
            >
              <ArrowLeftIcon />
            </button>
          ) : null}
          {choosing === "folder"
            ? "Folder"
            : choosing === "shard"
              ? "Add to a shard"
              : "Save to Netherstone"}
        </span>
      }
    >
      {/* Each share starts afresh. */}
      {content ? <ShareForm key={id} content={content} choosing={choosing} /> : null}
    </BottomSheet>
  );
}

function ShareForm({
  content,
  choosing,
}: {
  content: ShareContent;
  choosing: "folder" | "shard" | null;
}) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);
  const screen = usePhoneScreen();
  const [where, setWhere] = useState<Where>("new");
  // It starts where the person is: the folder on screen, or the vault's
  // top; and the shard on screen, or the last one opened.
  const [folder, setFolder] = useState(() =>
    screen.kind === "folder" ? screen.path : vaultPath,
  );
  const [shard, setShard] = useState(() => {
    const open = useEditorStore.getState().currentFilePath;
    if (screen.kind === "file" && open && isMarkdownPath(open)) return open;
    const recent = useUIStore
      .getState()
      .recentFiles.find(
        (file) => !!vaultPath && isPathWithin(file.path, vaultPath) && isMarkdownPath(file.path),
      );
    return recent?.path ?? null;
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!vaultPath || saving) return;
    const target =
      where === "new"
        ? { kind: "new" as const, folder: folder ?? vaultPath }
        : shard
          ? { kind: "add" as const, shard }
          : null;
    if (!target) return;
    setSaving(true);
    try {
      const saved = await saveShare(content, target, vaultPath);
      const onScreen =
        screen.kind === "file" &&
        isSamePath(useEditorStore.getState().currentFilePath ?? "", saved);
      if (onScreen) closeShareIn();
      else await openFileScreen(saved, true);
    } catch (error) {
      reportFailure("Couldn't save what was shared", error);
    } finally {
      setSaving(false);
    }
  }

  const choose = (kind: "folder" | "shard") =>
    usePhoneNav.getState().push({ kind: "share-place", choose: kind });
  const chosen = (set: () => void) => {
    set();
    usePhoneNav.getState().back();
  };

  if (choosing === "folder" && vaultPath)
    return (
      <FolderList
        vaultPath={vaultPath}
        tree={fileTree}
        current={folder}
        onPick={(path) => chosen(() => setFolder(path))}
      />
    );
  if (choosing === "shard")
    return (
      <ShardList
        tree={fileTree}
        current={shard}
        onPick={(path) => chosen(() => setShard(path))}
      />
    );

  const shown = preview(content);
  const shardName = shard
    ? displayNameOf(shard)
    : null;

  return (
    <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
      <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
        <span className="flex text-muted-foreground [&_svg]:size-5">{shown.icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate font-medium">{shown.name}</span>
          {shown.detail ? (
            <span className="truncate text-sm text-muted-foreground">{shown.detail}</span>
          ) : null}
        </span>
      </div>

      <div role="radiogroup" aria-label="Where it goes" className="flex flex-col">
        {(["new", "add"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={where === option}
            className="flex h-13 items-center gap-4 text-left text-base outline-none"
            onClick={() => setWhere(option)}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-5 shrink-0 rounded-full",
                where === option
                  ? "border-[6px] border-brand"
                  : "border-[1.6px] border-muted-foreground",
              )}
            />
            {option === "new" ? "New shard" : "Add to a shard"}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="flex h-14 items-center gap-4 border-y border-border text-left text-base outline-none active:bg-accent [&_svg]:size-5"
        onClick={() => choose(where === "new" ? "folder" : "shard")}
      >
        <span className="flex text-muted-foreground">
          {where === "new" ? <FolderIcon /> : <FileTextIcon />}
        </span>
        <span className="flex-1">{where === "new" ? "Folder" : "Shard"}</span>
        <span className="max-w-[50%] truncate text-sm text-muted-foreground">
          {where === "new" ? (folder ? folderName(folder) : "") : (shardName ?? "Choose")}
        </span>
        <span className="flex text-muted-foreground">
          <ChevronRightIcon />
        </span>
      </button>

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-11 px-4.5 text-base"
          onClick={closeShareIn}
        >
          Cancel
        </Button>
        <Button
          type="button"
          className="h-11 px-4.5 text-base"
          disabled={saving || !vaultPath || (where === "add" && !shard)}
          onClick={() => void save()}
        >
          Save
        </Button>
      </div>
    </div>
  );
}

function PlaceRow({
  icon,
  label,
  depth = 0,
  current,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  depth?: number;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={current || undefined}
      className="flex h-13 w-full items-center gap-4 pr-4 text-left text-base outline-none active:bg-accent aria-[current]:font-medium [&_svg]:size-5 [&_svg]:shrink-0"
      style={{ paddingLeft: `calc(1rem + ${depth} * 1.25rem)` }}
      onClick={onClick}
    >
      <span className="flex text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

/** The vault's top and every folder in it, nested. */
function FolderList({
  vaultPath,
  tree,
  current,
  onPick,
}: {
  vaultPath: string;
  tree: FileTreeNode[];
  current: string | null;
  onPick: (path: string) => void;
}) {
  const isCurrent = (path: string) => !!current && isSamePath(current, path);
  return (
    <div className="pb-2">
      <PlaceRow
        icon={<FolderIcon />}
        label={folderName(vaultPath)}
        current={isCurrent(vaultPath)}
        onClick={() => onPick(vaultPath)}
      />
      {foldersOf(tree).map(({ node, depth }) => (
        <PlaceRow
          key={node.path}
          icon={<FolderIcon />}
          label={node.name}
          depth={depth + 1}
          current={isCurrent(node.path)}
          onClick={() => onPick(node.path)}
        />
      ))}
    </div>
  );
}

/** The vault's shards, last opened first, narrowed by what's typed. */
function ShardList({
  tree,
  current,
  onPick,
}: {
  tree: FileTreeNode[];
  current: string | null;
  onPick: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const recentFiles = useUIStore((s) => s.recentFiles);
  const shards = useMemo(() => {
    const order = new Map(recentFiles.map((file, index) => [file.path, index]));
    return flattenFiles(tree).filter((file) => isMarkdownPath(file.path)).sort(
      (a, b) =>
        (order.get(a.path) ?? Infinity) - (order.get(b.path) ?? Infinity) ||
        a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }, [tree, recentFiles]);
  const needle = query.trim().toLowerCase();
  const shown = (needle
    ? shards.filter((node) => node.name.toLowerCase().includes(needle))
    : shards
  ).slice(0, SHARDS_SHOWN);

  return (
    <div className="flex flex-col pb-2">
      <label className="mx-4 mb-2 flex h-12 items-center gap-3 rounded-3xl border border-border bg-card px-4 text-muted-foreground [&_svg]:size-5">
        <SearchIcon />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search shards"
          aria-label="Search shards"
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none"
        />
      </label>
      {shown.map((node) => (
        <PlaceRow
          key={node.path}
          icon={<FileTextIcon />}
          label={getVaultFileDisplayName(node.name)}
          current={!!current && isSamePath(current, node.path)}
          onClick={() => onPick(node.path)}
        />
      ))}
      {shown.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No shards match.</p>
      ) : null}
    </div>
  );
}
