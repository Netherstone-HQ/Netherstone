import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Plate, usePlateEditor } from "platejs/react";

import { resolveSessionValue } from "@/components/editor/lib/session-value";
import {
  isInlineElement,
  VersionPreviewKit,
} from "@/components/history/history-diff-kit";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import { type ChatChange, previewChange } from "@/lib/commands/assistant";
import { diffShardValues } from "@/lib/history-diff";
import { remoteMediaIn, withRemoteMediaAsLinks } from "@/lib/remote-media";

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

function PreviewDocument({ value }: { value: any[] }) {
  const editor = usePlateEditor({
    plugins: VersionPreviewKit,
    value,
    readOnly: true,
    chunking: { chunkSize: 100 },
    navigationFeedback: false,
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // Opens on the change, so it's in view without scrolling for it.
  useLayoutEffect(() => {
    rootRef.current
      ?.querySelector("[data-history-block]")
      ?.scrollIntoView({ block: "center" });
  }, []);

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
 * marked. The editor stays as it was underneath.
 */
export function ChangePreview({
  change,
  filePath,
}: {
  change: ChatChange;
  filePath: string;
}) {
  const value = usePreviewValue(change, filePath);
  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {value ? (
        <PreviewDocument key={`${change.id}:${change.count}`} value={value} />
      ) : null}
    </div>
  );
}
