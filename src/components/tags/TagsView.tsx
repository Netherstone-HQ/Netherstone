import { useCallback, useEffect, useRef, useState } from "react";
import { TagIcon } from "lucide-react";

import { Highlight, HighlightedText } from "@/components/HighlightedText";
import { NextPageTrigger } from "@/components/NextPageTrigger";
import { LeftSidebarToggle } from "@/components/PanelToggles";
import { Separator } from "@/components/ui/separator";
import {
  getFolderInVault,
  getVaultFileDisplayName,
} from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { formatModified, type TaggedFile } from "@/lib/tags";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
import { selectActiveTag, useTagsStore } from "@/store/tags";

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
  const folder = getFolderInVault(file.path, vaultPath);

  /** Opens the shard scrolled to the tag shown, with the tag selected. */
  async function open() {
    const { setPendingLinkReveal } = useEditorStore.getState();
    if (shown) setPendingLinkReveal({ path: file.path, tag: shown.tag });
    try {
      await openEditorFile(file.path);
      useUIStore.getState().openMode("editor");
    } catch (error) {
      setPendingLinkReveal(null);
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
        {shown?.excerpt ? (
          <span className="line-clamp-2 text-ui-sm text-foreground/80 leading-relaxed">
            <HighlightedText parts={shown.excerpt} />
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
        Type # and a word anywhere in a shard, like{" "}
        <Highlight>#ideas</Highlight>, and the shard shows up here.
      </p>
    </div>
  );
}

/** Results drawn at a time; more appear as you scroll. */
const PAGE_SIZE = 50;

/** Tags mode's main area: the shards with the selected tag, or every tagged one. */
export function TagsView() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const files = useTagsStore((s) => s.files);
  const status = useTagsStore((s) => s.status);
  const isStale = useTagsStore((s) => s.isStale);
  const activeTag = useTagsStore(selectActiveTag);
  const load = useTagsStore((s) => s.load);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState({ tag: activeTag, count: PAGE_SIZE });

  // Loads on each visit if the index changed since, and again if it changes
  // while Tags is open.
  useEffect(() => {
    if (vaultPath) void load(vaultPath);
  }, [vaultPath, isStale, load]);

  // Another tag starts again from the top, one page in.
  if (page.tag !== activeTag) setPage({ tag: activeTag, count: PAGE_SIZE });
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [activeTag]);

  const showNextPage = useCallback(
    () => setPage((p) => ({ ...p, count: p.count + PAGE_SIZE })),
    [],
  );

  const results = activeTag
    ? files.filter((file) => file.tags.some(({ tag }) => tag === activeTag))
    : files;
  const shown = results.slice(0, page.count);

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
            {shown.map((file) => (
              <TagResult
                key={file.path}
                file={file}
                tag={activeTag}
                vaultPath={vaultPath}
              />
            ))}
            {shown.length < results.length ? (
              // Keyed by the count so each page observes afresh, in case the
              // trigger is still in view after the last one.
              <NextPageTrigger
                key={shown.length}
                scrollRoot={scrollRef}
                onReach={showNextPage}
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
        <span className="px-1.5 font-medium text-ui">Tags</span>
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="mx-auto max-w-180">{content}</div>
      </div>
    </div>
  );
}
