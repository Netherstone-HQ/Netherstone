import { EllipsisVerticalIcon, SearchIcon } from "lucide-react";
import { useVaultStore } from "@/store";
import { CaptureBar } from "./CaptureBar";
import { usePhoneNav, useSelecting } from "./nav";
import {
  PhoneBackButton,
  PhoneFrame,
  PhoneIconButton,
  PhoneTitle,
  PhoneTopBar,
} from "./parts";
import { FileRow, FolderRow } from "./rows";
import { SelectActionBar, SelectTopBar } from "./SelectBars";
import { usePhonePrefs } from "./prefs";
import { usePreviews } from "./usePreviews";
import { findFolder, newestFirst, splitChildren } from "./vault-tree";

/** One folder: its folders, then its shards and drawings. */
export function FolderScreen({ path }: { path: string }) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);
  const push = usePhoneNav((s) => s.push);
  const sortByDate = usePhonePrefs((s) => s.sortByDate);
  const folder = findFolder(fileTree, path);
  const { folders, files } = splitChildren(folder?.children ?? []);
  const previews = usePreviews(files.map((f) => f.path));
  const selecting = useSelecting();
  const shownFolders = selecting ? [] : folders;

  return (
    <PhoneFrame bottomInset={false}>
      {selecting ? (
        <SelectTopBar shown={files.map((file) => file.path)} />
      ) : (
        <PhoneTopBar>
          <PhoneBackButton />
          <PhoneTitle>{folder?.name ?? path.split(/[\\/]/).pop()}</PhoneTitle>
          <PhoneIconButton
            label="Search in this folder"
            onClick={() => push({ kind: "search", folder: path })}
          >
            <SearchIcon />
          </PhoneIconButton>
          <PhoneIconButton
            label="More"
            onClick={() => push({ kind: "more-menu", folder: path })}
          >
            <EllipsisVerticalIcon />
          </PhoneIconButton>
        </PhoneTopBar>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {shownFolders.map((child) => (
          <FolderRow key={child.path} folder={child} />
        ))}
        {shownFolders.length > 0 && files.length > 0 ? (
          <div role="separator" className="mx-4 my-1 h-px bg-border" />
        ) : null}
        {(sortByDate
          ? newestFirst(files, (path) => previews.get(path)?.lastModified)
          : files
        ).map((file) => (
          <FileRow
            key={file.path}
            path={file.path}
            preview={previews.get(file.path)}
          />
        ))}
      </div>

      {selecting ? (
        <SelectActionBar />
      ) : vaultPath ? (
        <CaptureBar vaultPath={vaultPath} folder={path} />
      ) : null}
    </PhoneFrame>
  );
}
