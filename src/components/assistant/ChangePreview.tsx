import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plate, usePlateEditor } from "platejs/react";

import { resolveSessionValue } from "@/components/editor/lib/session-value";
import {
  isInlineElement,
  VersionPreviewKit,
} from "@/components/history/history-diff-kit";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import { type ChatChange, previewChange } from "@/lib/commands";
import { diffShardValues } from "@/lib/history-diff";
import { remoteMediaIn, withRemoteMediaAsLinks } from "@/lib/remote-media";
import { useEditorStore } from "@/store/editor";

/** The element that scrolls `node`, if any. */
function scrollerOf(node: Element | null | undefined): HTMLElement | null {
  for (let el = node?.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** How far the open shard is scrolled, so the preview opens where it is. */
function editorScrollTop() {
  const editor = useEditorStore.getState().plateEditor;
  if (!editor) return 0;
  try {
    return scrollerOf(editor.api.toDOMNode(editor))?.scrollTop ?? 0;
  } catch {
    return 0;
  }
}

/** The change laid over the open shard as it is now. */
function usePreviewValue(change: ChatChange, filePath: string) {
  const key = `${change.id}:${change.count}`;
  const [loaded, setLoaded] = useState<{ key: string; value: any[] } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // What's typed is saved first, so the change is laid over it.
      await flushPendingAutosave();
      const preview = await previewChange(change.id);
      // Both read the same way, so only what the change does differs.
      const [before, after] = await Promise.all([
        resolveSessionValue(filePath, preview.before, null),
        resolveSessionValue(filePath, preview.after, null),
      ]);
      if (cancelled) return;
      // Media the change adds from the web shows as its address until applied.
      const shown = withRemoteMediaAsLinks(after, remoteMediaIn(before));
      setLoaded({
        key,
        value: diffShardValues(shown, before, isInlineElement, {
          wholeBlocks: true,
        }),
      });
    })().catch((error) => {
      console.error("[Netherstone] Couldn't show the change:", error);
    });
    return () => {
      cancelled = true;
    };
  }, [change.id, filePath, key]);

  return loaded?.key === key ? loaded.value : null;
}

function PreviewDocument({
  value,
  scrollTop,
}: {
  value: any[];
  scrollTop: number;
}) {
  const editor = usePlateEditor({
    plugins: VersionPreviewKit,
    value,
    readOnly: true,
    chunking: { chunkSize: 100 },
    navigationFeedback: false,
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // Opens where the shard was, so nothing moves, and scrolls only as far
  // as it takes to bring the change into view.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const scroller = scrollerOf(root?.querySelector("[data-slate-editor]"));
    if (scroller) scroller.scrollTop = scrollTop;
    root
      ?.querySelector("[data-history-block]")
      ?.scrollIntoView({ block: "nearest" });
  }, [scrollTop]);

  return (
    <div ref={rootRef} className="change-preview min-h-0 flex-1">
      <Plate editor={editor} readOnly>
        <EditorContainer>
          <PlateEditor readOnly aria-label="Change to the shard" />
        </EditorContainer>
      </Plate>
    </div>
  );
}

/**
 * A change the assistant proposed, shown in the open shard's place until
 * it's applied or discarded: what goes struck through, what comes in
 * marked. The editor stays as it was underneath, and in view until the
 * preview is ready to cover it, so nothing blanks in between.
 */
export function ChangePreview({
  change,
  filePath,
}: {
  change: ChatChange;
  filePath: string;
}) {
  const value = usePreviewValue(change, filePath);
  const [scrollTop] = useState(editorScrollTop);
  if (!value) return null;
  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <PreviewDocument
        key={`${change.id}:${change.count}`}
        value={value}
        scrollTop={scrollTop}
      />
    </div>
  );
}
