import {
  ChevronDownIcon,
  CloudIcon,
  CloudOffIcon,
  EllipsisVerticalIcon,
  FileTextIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConflictDialog } from "@/components/sync/ConflictDialog";
import { getFolderInVault, isPathWithin } from "@/lib/drawing-files";
import { folderName } from "@/lib/open-vault";
import { shownRecentFiles } from "@/lib/recent-files";
import { cn } from "@/lib/utils";
import { useSettingsStore, useUIStore, useVaultStore } from "@/store";
import { useSyncStore } from "@/store/sync";
import { CaptureBar } from "./CaptureBar";
import { usePhoneNav, useSelecting } from "./nav";
import {
  PhoneFrame,
  PhoneIconButton,
  PhoneSection,
  PhoneTopBar,
} from "./parts";
import { FileRow, FolderRow } from "./rows";
import { SelectActionBar, SelectTopBar } from "./SelectBars";
import { SyncStrip, useSyncProblem } from "./SyncStrip";
import { usePhonePrefs } from "./prefs";
import { usePreviews } from "./usePreviews";
import { newestFirst, splitChildren } from "./vault-tree";

/** The vault's home: search, pinned, recent and its folders and shards. */
export function HomeScreen() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);
  const isLoading = useVaultStore((s) => s.isVaultLoading);
  const pinnedFiles = useUIStore((s) => s.pinnedFiles);
  const recentFiles = useUIStore((s) => s.recentFiles);
  const showRecent = useSettingsStore((s) => s.showRecentFiles);
  const recentLimit = useSettingsStore((s) => s.recentFilesLimit);
  const push = usePhoneNav((s) => s.push);
  const sortByDate = usePhonePrefs((s) => s.sortByDate);
  const problem = useSyncProblem(vaultPath);
  const selecting = useSelecting();

  const pinned = vaultPath
    ? pinnedFiles.filter((file) => isPathWithin(file.path, vaultPath))
    : [];
  const recent = shownRecentFiles(
    recentFiles,
    vaultPath,
    showRecent,
    recentLimit,
  ).filter((file) => !pinned.some((p) => p.path === file.path));
  const { folders, files } = splitChildren(fileTree);
  const previews = usePreviews([
    ...pinned.map((f) => f.path),
    ...recent.map((f) => f.path),
    ...files.map((f) => f.path),
  ]);
  const isEmpty = !isLoading && fileTree.length === 0;
  const sortedFiles = sortByDate
    ? newestFirst(files, (path) => previews.get(path)?.lastModified)
    : files;
  const fileRows = sortedFiles.map((file) => (
    <FileRow
      key={file.path}
      path={file.path}
      preview={previews.get(file.path)}
    />
  ));

  return (
    <PhoneFrame bottomInset={false}>
      {selecting ? (
        <SelectTopBar
          shown={[...pinned, ...recent, ...files].map((file) => file.path)}
        />
      ) : (
        <PhoneTopBar>
          <button
            type="button"
            className="flex h-12 min-w-0 items-center gap-1.5 rounded-full pr-2 pl-3 text-xl leading-7 font-semibold outline-none active:bg-accent"
            onClick={() => push({ kind: "vault-menu" })}
          >
            <span className="truncate">
              {vaultPath ? folderName(vaultPath) : "No vault"}
            </span>
            <ChevronDownIcon className="size-5 shrink-0" />
          </button>
          <div className="flex-1" />
          <SyncButton vaultPath={vaultPath} />
          <PhoneIconButton
            label="More"
            onClick={() => push({ kind: "more-menu", folder: vaultPath })}
          >
            <EllipsisVerticalIcon />
          </PhoneIconButton>
        </PhoneTopBar>
      )}

      {vaultPath && problem && !selecting ? (
        <SyncStrip vaultPath={vaultPath} problem={problem} />
      ) : null}

      {selecting ? null : (
        <SearchField onOpen={() => push({ kind: "search" })} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {isLoading ? (
          <LoadingRows />
        ) : isEmpty && vaultPath ? (
          <EmptyVault folder={vaultPath} />
        ) : vaultPath ? (
          <>
            {pinned.length > 0 ? (
              <PhoneSection label="Pinned">
                {pinned.map((file) => (
                  <FileRow
                    key={file.path}
                    path={file.path}
                    detail={getFolderInVault(file.path, vaultPath)}
                    preview={previews.get(file.path)}
                  />
                ))}
              </PhoneSection>
            ) : null}
            {recent.length > 0 ? (
              <PhoneSection label="Recent">
                {recent.map((file) => (
                  <FileRow
                    key={file.path}
                    path={file.path}
                    detail={getFolderInVault(file.path, vaultPath)}
                    preview={previews.get(file.path)}
                  />
                ))}
              </PhoneSection>
            ) : null}
            {selecting ? (
              fileRows
            ) : folders.length > 0 || files.length > 0 ? (
              <PhoneSection label="Folders">
                {folders.map((folder) => (
                  <FolderRow key={folder.path} folder={folder} />
                ))}
                {fileRows}
              </PhoneSection>
            ) : null}
          </>
        ) : null}
      </div>

      {selecting ? (
        <SelectActionBar />
      ) : vaultPath ? (
        <CaptureBar vaultPath={vaultPath} folder={vaultPath} />
      ) : null}
      {vaultPath ? <ConflictDialog vaultPath={vaultPath} /> : null}
    </PhoneFrame>
  );
}

/** The cloud in the top bar: how sync is doing, opening the vault menu. */
function SyncButton({ vaultPath }: { vaultPath: string | null }) {
  const enabled = useSyncStore(
    (s) => s.vaultPath === vaultPath && !!s.record?.syncEnabled,
  );
  const problem = useSyncProblem(vaultPath);
  const push = usePhoneNav((s) => s.push);
  if (!enabled) return null;

  const label =
    problem === "offline"
      ? "Sync: offline"
      : problem
        ? "Sync needs attention"
        : "Sync: up to date";
  return (
    <PhoneIconButton label={label} onClick={() => push({ kind: "vault-menu" })}>
      {problem === "offline" ? <CloudOffIcon /> : <CloudIcon />}
      {problem === "offline" ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-3 right-[11px] size-2 rounded-full",
            problem ? "bg-destructive" : "bg-brand",
          )}
        />
      )}
    </PhoneIconButton>
  );
}

/** Looks like a search field; opens Search. */
export function SearchField({
  onOpen,
  label = "Search this vault",
}: {
  onOpen: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      className="mx-4 mb-2 flex h-12 shrink-0 items-center gap-3 rounded-3xl border bg-card px-4 text-left text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={onOpen}
    >
      <SearchIcon className="size-5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function EmptyVault({ folder }: { folder: string }) {
  const push = usePhoneNav((s) => s.push);
  return (
    <div className="flex flex-col items-center gap-4 px-4 pt-32">
      <FileTextIcon className="size-8 text-muted-foreground" />
      <p className="text-lg font-semibold">No shards yet</p>
      <Button
        className="h-11 gap-2 px-4.5 text-base"
        onClick={() => push({ kind: "new-shard", folder })}
      >
        <PlusIcon className="size-5" />
        New shard
      </Button>
    </div>
  );
}

/** Grey bars where the rows will be, while the vault loads. */
function LoadingRows() {
  const widths = ["w-37", "w-52", "w-30", "w-60", "w-42", "w-50"];
  return (
    <div role="status" aria-label="Loading the vault" className="pt-6">
      {widths.map((width, at) => (
        <div key={at} className="flex h-16 items-start gap-3 px-4 pt-2">
          <span className="size-5 shrink-0 rounded-md bg-accent" />
          <span className="flex flex-1 flex-col gap-3 pt-1">
            <span className={cn("h-3 rounded-md bg-accent", width)} />
            <span className="h-3 w-27 rounded-md bg-accent" />
          </span>
        </div>
      ))}
    </div>
  );
}
