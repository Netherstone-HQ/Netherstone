import { useState } from "react";
import {
  CheckIcon,
  FileIcon,
  FilePlusIcon,
  FolderInputIcon,
  XIcon,
} from "lucide-react";

import { DrawingIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  applyAssistantChange,
  discardAssistantChange,
  openShardPath,
  undoAssistantChange,
} from "@/lib/assistant-changes";
import type { ChatChange } from "@/lib/commands/assistant";
import { cn } from "@/lib/utils";
import { useAssistantStore } from "@/store/assistant";
import { useEditorStore } from "@/store/editor";
import { useVaultStore } from "@/store/vault";

import { ChangeContent } from "../ChangeContent";
import { shardName } from "../Composer";
import { openShard } from "./open";

function changeCount(count: number) {
  return count === 1 ? "1 change" : `${count} changes`;
}

/** The folder a vault path is in, as a card names it. */
function folderOf(path: string) {
  const parts = path.split("/").slice(0, -1);
  return parts.length > 0 ? parts.join("/") : "the top of the vault";
}

/** Where a move takes it, and its new name, as a card says them. */
function moveParts(change: ChatChange) {
  const { folder = null, name = null } = change.moving ?? {};
  return {
    where: folder === null ? null : folder === "" ? "the top of the vault" : folder,
    renamed: name ? shardName(name) : null,
  };
}

/** What a change does, as its card says it before it's applied. */
function changeTitle(change: ChatChange) {
  const name = shardName(change.path);
  switch (change.kind) {
    case "newShard":
      return `New shard ${name} in ${folderOf(change.path)}`;
    case "newDrawing":
      return `New drawing ${name} in ${folderOf(change.path)}`;
    case "move": {
      const { where, renamed } = moveParts(change);
      if (where !== null && renamed) return `Move ${name} to ${where} as ${renamed}`;
      if (where !== null) return `Move ${name} to ${where}`;
      return `Rename ${name} to ${renamed ?? ""}`;
    }
    default:
      return name;
  }
}

/** What an applied change did, around the link to what it left. */
function appliedWords(change: ChatChange): [string, string] {
  switch (change.kind) {
    case "newShard":
    case "newDrawing":
      return ["Created ", ` in ${folderOf(change.path)}`];
    case "move": {
      const { where, renamed } = moveParts(change);
      const old = shardName(change.path);
      if (where === null) return [`Renamed ${old} to `, ""];
      return renamed ? [`Moved ${old} to ${where} as `, ""] : ["Moved ", ` to ${where}`];
    }
    default:
      return ["Applied to ", ""];
  }
}

/** What a discarded change would have done, as its trace says it. */
function discardedTitle(change: ChatChange) {
  const title = changeTitle(change);
  return change.kind === "shard" || change.kind === "drawing"
    ? `Discarded the change to ${title}`
    : `Discarded: ${title.charAt(0).toLowerCase()}${title.slice(1)}`;
}

function ChangeIcon({ kind }: { kind: ChatChange["kind"] }) {
  const className = "size-4 shrink-0 text-muted-foreground";
  switch (kind) {
    case "newShard":
      return <FilePlusIcon className={className} />;
    case "drawing":
    case "newDrawing":
      return <DrawingIcon className={className} />;
    case "move":
      return <FolderInputIcon className={className} />;
    default:
      return <FileIcon className={className} />;
  }
}

/** Where the file a change made or changed is once it's applied. */
function appliedPath(change: ChatChange): string {
  if (change.kind !== "move") return change.path;
  const { folder = null, name = null } = change.moving ?? {};
  const parts = change.path.split("/");
  const old = parts.pop() ?? change.path;
  const extension = /\.(md|excalidraw)$/i.exec(old)?.[0] ?? "";
  const renamed = name
    ? name.toLowerCase().endsWith(extension.toLowerCase())
      ? name
      : name + extension
    : old;
  const where = folder === null ? parts.join("/") : folder;
  return where ? `${where}/${renamed}` : renamed;
}

/** Brings the open shard's preview of a change back into view. */
function revealPreview() {
  // Set aside to edit: shown again, and it brings the change into view.
  if (useAssistantStore.getState().previewSetAside !== null) {
    useAssistantStore.setState({ previewSetAside: null });
    return;
  }
  document
    .querySelector(".change-preview [data-history-block]")
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
}

/**
 * A file's name in a change card that opens it, or for a change to the
 * open shard, brings its preview there into view.
 */
function FileLink({
  path,
  onOpen,
  children,
}: {
  path: string;
  onOpen?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onOpen ?? (() => openShard({ path, section: null }))}
      className="min-w-0 truncate text-left font-medium underline-offset-2 hover:underline"
    >
      {children}
    </button>
  );
}

/**
 * A change an answer proposed: to look at, then apply or not. A change to
 * the open shard shows in its place, and its name brings it back into
 * view; one to another shard opens it from its name; a new shard or
 * drawing, or a changed drawing, shows in the card; a move says where it
 * goes. Once applied, its name opens what it made or changed.
 */
export function ChangeCard({ change }: { change: ChatChange }) {
  const busy = useAssistantStore((s) => s.busyChanges.includes(change.id));
  const vault = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  if (change.state === "discarded") {
    return (
      <div className="flex items-center gap-2 rounded-[10px] border border-dashed py-2.5 pr-2 pl-3 text-muted-foreground">
        <XIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{discardedTitle(change)}</span>
      </div>
    );
  }
  if (change.state === "applied") {
    const path = appliedPath(change);
    const [before, after] = appliedWords(change);
    return (
      <div className="flex items-center gap-2 rounded-[10px] border bg-card py-2.5 pr-2 pl-3">
        <CheckIcon className="size-4 shrink-0 text-brand" />
        <span className="min-w-0 flex-1 break-words">
          {before}
          {isOpenable(path) ? (
            <FileLink path={path}>{shardName(path)}</FileLink>
          ) : (
            shardName(path)
          )}
          {after}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void undoAssistantChange(change)}
        >
          Undo
        </Button>
      </div>
    );
  }
  const title = changeTitle(change);
  const inCard = change.kind !== "shard" && change.kind !== "move";
  const onOpenShard =
    change.kind === "shard" && openShardPath(vault, openPath) === change.path;
  const linked = change.kind === "shard" || change.kind === "drawing";
  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] border bg-card p-3">
      <div className="flex min-w-0 items-center gap-2">
        <ChangeIcon kind={change.kind} />
        {linked ? (
          <FileLink
            path={change.path}
            onOpen={onOpenShard ? revealPreview : undefined}
          >
            {title}
          </FileLink>
        ) : (
          <span
            className={cn(
              "min-w-0 font-medium",
              change.kind === "move" ? "break-words" : "truncate",
            )}
          >
            {title}
          </span>
        )}
        {(change.kind === "shard" || change.kind === "drawing") && (
          <span className="shrink-0 text-muted-foreground text-ui-sm">
            {changeCount(change.count)}
          </span>
        )}
      </div>
      {inCard && <ChangeContent change={change} label={`Preview of ${title}`} />}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => void discardAssistantChange(change)}
        >
          Discard
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => void applyAssistantChange(change)}
        >
          {change.kind === "newShard" || change.kind === "newDrawing" ? "Create" : "Apply"}
        </Button>
      </div>
    </div>
  );
}

/** Apply all and Discard all, for an answer with more than one change left. */
export function AllChanges({ changes }: { changes: ChatChange[] }) {
  const pending = changes.filter((change) => change.state === "pending");
  const [running, setRunning] = useState(false);
  const busy = useAssistantStore((s) =>
    pending.some((change) => s.busyChanges.includes(change.id)),
  );
  if (pending.length < 2) return null;
  const each = async (run: (change: ChatChange) => Promise<void>) => {
    const chat = useAssistantStore.getState().chat?.id;
    setRunning(true);
    try {
      for (const { id } of pending) {
        // Each as it stands now: one may have been done from its own card.
        const now = useAssistantStore.getState();
        if (now.chat?.id !== chat) break;
        const change = now.changes.find((c) => c.id === id);
        if (change?.state === "pending") await run(change);
      }
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="flex justify-end gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy || running}
        onClick={() => void each(discardAssistantChange)}
      >
        Discard all
      </Button>
      <Button
        type="button"
        size="sm"
        disabled={busy || running}
        onClick={() => void each(applyAssistantChange)}
      >
        Apply all
      </Button>
    </div>
  );
}

/** Whether a path names a shard or drawing, rather than a folder. */
function isOpenable(path: string) {
  return /\.(md|excalidraw)$/i.test(path);
}
