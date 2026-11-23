import { FileTextIcon, FolderIcon } from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import type { ShardPreview } from "@/lib/commands/shards";
import { getVaultFileDisplayName, isDrawingPath } from "@/lib/drawing-files";
import { formatModified } from "@/lib/tags";
import type { FileTreeNode } from "@/store";
import { openFileScreen } from "./open-file";
import { Sep } from "./parts";
import { usePhoneNav } from "./nav";
import { countFiles, fileKindLabel } from "./vault-tree";

function fileName(path: string) {
  return getVaultFileDisplayName(path.split(/[\\/]/).pop() ?? path);
}

/**
 * A shard or drawing: its name, then when it was edited and either the
 * folder it's in or its first line.
 */
export function FileRow({
  path,
  detail,
  preview,
}: {
  path: string;
  /** The folder it's in; without it the row shows the file's first line. */
  detail?: string;
  preview: ShardPreview | undefined;
}) {
  const Icon = isDrawingPath(path) ? DrawingIcon : FileTextIcon;
  const second =
    detail ?? preview?.preview ?? fileKindLabel(path) ?? undefined;
  const date =
    preview?.lastModified != null ? formatModified(preview.lastModified) : null;

  return (
    <button
      type="button"
      className="flex min-h-16 w-full flex-col justify-center gap-0.5 px-4 text-left outline-none active:bg-accent"
      onClick={() => void openFileScreen(path)}
    >
      <span className="flex w-full min-w-0 items-center gap-3">
        <Icon className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {fileName(path)}
        </span>
      </span>
      {date || second ? (
        <span className="flex w-full min-w-0 items-center gap-2 pl-8 text-sm leading-5 text-muted-foreground">
          {date ? <span className="shrink-0">{date}</span> : null}
          {date && second ? <Sep /> : null}
          {second ? <span className="min-w-0 truncate">{second}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

/** A folder, with how many files are inside it. */
export function FolderRow({ folder }: { folder: FileTreeNode }) {
  const push = usePhoneNav((s) => s.push);
  return (
    <button
      type="button"
      className="flex h-14 w-full items-center gap-3 px-4 text-left outline-none active:bg-accent"
      onClick={() => push({ kind: "folder", path: folder.path })}
    >
      <FolderIcon className="size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
      <span className="text-sm text-muted-foreground">
        {countFiles(folder)}
      </span>
    </button>
  );
}
