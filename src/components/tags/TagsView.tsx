import { useEffect } from "react";
import { TagIcon } from "lucide-react";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  getFolderInVault,
  getVaultFileDisplayName,
} from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { formatModified, splitAtTag, type TaggedFile } from "@/lib/tags";
import { useUIStore, useVaultStore } from "@/store";
import { selectActiveTag, useTagsStore } from "@/store/tags";

/** A tag as it's highlighted in a line of text. */
function TagMark({ children }: { children: React.ReactNode }) {
  return (
    <mark className="rounded-[3px] bg-sidebar-primary/15 px-0.5 text-sidebar-primary">
      {children}
    </mark>
  );
}

function TagResult({
  file,
  tag,
  vaultPath,
}: {
  file: TaggedFile;
  /** The tag whose line to show; null shows the first and lists them all. */
  tag: string | null;
  vaultPath: string;
}) {
  const shown = file.tags.find((t) => t.tag === tag) ?? file.tags[0];
  const line = shown?.line ? splitAtTag(shown.line, shown.tag) : null;
  const folder = getFolderInVault(file.path, vaultPath);

  async function open() {
    try {
      await openEditorFile(file.path);
      useUIStore.getState().openMode("editor");
    } catch (error) {
      console.error("[Netherstone] Failed to open tagged shard:", error);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void open()}
        className="flex w-full flex-col gap-1.5 rounded-lg px-3.5 py-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex w-full min-w-0 items-baseline gap-2.5">
          <span className="min-w-0 truncate font-medium text-ui">
            {getVaultFileDisplayName(file.name)}
          </span>
          {folder ? (
            <span className="min-w-0 shrink truncate text-ui-sm text-muted-foreground">
              {folder}
            </span>
          ) : null}
          <span className="ml-auto shrink-0 text-ui-sm text-muted-foreground">
            {formatModified(file.last_modified)}
          </span>
        </span>
        {line ? (
          <span className="line-clamp-2 text-ui-sm text-foreground/80 leading-relaxed">
            {line.before}
            {line.match ? <TagMark>{line.match}</TagMark> : null}
            {line.after}
          </span>
        ) : null}
        {tag === null && file.tags.length > 1 ? (
          <span className="flex flex-wrap gap-1.5">
            {file.tags.map(({ tag: name }) => (
              <span
                key={name}
                className="rounded-full border px-2 text-ui-sm text-muted-foreground"
              >
                #{name}
              </span>
            ))}
          </span>
        ) : null}
      </button>
    </li>
  );
}

function NoTagsYet() {
  return (
    <div className="mx-auto mt-24 flex max-w-96 flex-col items-center gap-2.5 text-center">
      <TagIcon className="size-7 text-muted-foreground" />
      <h2 className="font-semibold text-lg">No tags yet</h2>
      <p className="text-muted-foreground text-ui leading-relaxed">
        Type # and a word anywhere in a shard, like <TagMark>#ideas</TagMark>,
        and the shard shows up here.
      </p>
    </div>
  );
}

/** Tags mode's main area: the shards with the selected tag, or every tagged one. */
export function TagsView() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const files = useTagsStore((s) => s.files);
  const status = useTagsStore((s) => s.status);
  const activeTag = useTagsStore(selectActiveTag);
  const load = useTagsStore((s) => s.load);

  // Shards change while you're in other modes, so reload on every visit.
  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, load]);

  const results = activeTag
    ? files.filter((file) => file.tags.some(({ tag }) => tag === activeTag))
    : files;

  let content: React.ReactNode = null;
  if (status === "error") {
    content = (
      <p className="mt-24 text-center text-muted-foreground text-ui">
        Tags couldn't be loaded.
      </p>
    );
  } else if (status === "ready" && vaultPath) {
    content =
      files.length === 0 ? (
        <NoTagsYet />
      ) : (
        <>
          <h1 className="font-semibold text-2xl tracking-tight">
            {activeTag ? `#${activeTag}` : "All tagged shards"}
          </h1>
          <p className="mt-1 mb-5 text-muted-foreground text-ui-sm">
            {results.length} {results.length === 1 ? "shard" : "shards"}
            {activeTag ? null : " · newest first"}
          </p>
          <ul className="-mx-3.5 flex flex-col gap-1">
            {results.map((file) => (
              <TagResult
                key={file.path}
                file={file}
                tag={activeTag}
                vaultPath={vaultPath}
              />
            ))}
          </ul>
        </>
      );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-4" />
        <span className="font-medium text-ui">Tags</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-180">{content}</div>
      </div>
    </div>
  );
}
