import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CopyIcon, FilePlusIcon } from "lucide-react";
import { createSlateEditor } from "platejs";
import { Plate, usePlateEditor } from "platejs/react";
import { toast } from "sonner";

import { EditorKit } from "@/components/editor/editor-kit";
import { resolveSessionValue } from "@/components/editor/lib/session-value";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";
import type { RowAction } from "@/components/vault/RowActions";
import { readVersion, type FileVersion } from "@/lib/history";
import { diffShardValues } from "@/lib/history-diff";
import { saveVersionCopy } from "@/lib/history-restore";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor";
import { useHistoryStore } from "@/store/history";
import { useVaultStore } from "@/store/vault";
import { VersionPreviewKit } from "./history-diff-kit";
import { VersionBar } from "./VersionBar";

type Loaded = {
  id: string;
  markdown: string;
  /** The version laid over the shard as it is now. */
  value: any[];
};

let staticEditor: ReturnType<typeof createSlateEditor> | null = null;

/** Which elements sit inside a line of text, as the editor sees them. */
function isInline(element: any) {
  const editor =
    useEditorStore.getState().plateEditor ??
    (staticEditor ??= createSlateEditor({ plugins: EditorKit }));
  return editor.api.isInline(element);
}

/** The shard as it is now, as the editor shows it. */
async function currentValue(filePath: string) {
  const state = useEditorStore.getState();
  if (state.plateEditor && state.currentFilePath === filePath) {
    return state.plateEditor.children as any[];
  }
  return resolveSessionValue(filePath, state.markdownContent, null);
}

function useLoadedVersion(
  version: FileVersion,
  filePath: string,
  isDeleted: boolean,
) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const [loaded, setLoaded] = useState<
    Loaded | { id: string; error: string } | null
  >(null);

  useEffect(() => {
    if (!vaultPath) return;
    let cancelled = false;
    void (async () => {
      const markdown = await readVersion(vaultPath, version.blob);
      const [value, current] = await Promise.all([
        resolveSessionValue(filePath, markdown, null),
        // A deleted shard has nothing now to compare with.
        isDeleted ? null : currentValue(filePath),
      ]);
      if (cancelled) return;
      setLoaded({
        id: version.id,
        markdown,
        value: current ? diffShardValues(value, current, isInline) : value,
      });
    })().catch((error) => {
      console.error("[Netherstone] Couldn't show a version:", error);
      if (!cancelled) setLoaded({ id: version.id, error: String(error) });
    });
    return () => {
      cancelled = true;
    };
  }, [vaultPath, filePath, isDeleted, version.id, version.blob]);

  return loaded?.id === version.id ? loaded : null;
}

/** The version, read-only, with what restoring it would change marked. */
function VersionDocument({ value }: { value: any[] }) {
  const editor = usePlateEditor({
    plugins: VersionPreviewKit,
    value,
    readOnly: true,
    chunking: { chunkSize: 100 },
    navigationFeedback: false,
  });
  const showChanges = useHistoryStore((s) => s.showChanges);
  const rootRef = useRef<HTMLDivElement>(null);

  // Opens on the first change, so it's in view without scrolling for it.
  useLayoutEffect(() => {
    const first = rootRef.current?.querySelector(
      ".history-added, .history-removed, [data-history-block]",
    );
    first?.scrollIntoView({ block: "center" });
  }, []);

  return (
    <div
      ref={rootRef}
      className={cn(
        "min-h-0 flex-1",
        showChanges ? "history-changes-on" : "history-changes-off",
      )}
    >
      <Plate editor={editor} readOnly>
        <EditorContainer>
          <PlateEditor readOnly aria-label="Earlier version" />
        </EditorContainer>
      </Plate>
    </div>
  );
}

/**
 * An earlier version of the open shard, or of a deleted one, in the editor's
 * place, under the version bar. The editor stays as it was underneath, for
 * when "Now" is picked or history closes.
 */
export function ShardVersionView({
  version,
  filePath,
  isDeleted = false,
}: {
  version: FileVersion;
  filePath: string;
  isDeleted?: boolean;
}) {
  const loaded = useLoadedVersion(version, filePath, isDeleted);
  const markdown = loaded && "markdown" in loaded ? loaded.markdown : null;

  const moreActions: RowAction[] = markdown
    ? [
        {
          label: "Save as a copy",
          icon: FilePlusIcon,
          onSelect: () => void saveVersionCopy(filePath, markdown),
        },
        {
          label: "Copy text",
          icon: CopyIcon,
          onSelect: () =>
            void navigator.clipboard
              .writeText(markdown)
              .then(() => toast.success("Copied"))
              .catch(() => toast.error("Couldn't copy the text")),
        },
      ]
    : [];

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      <VersionBar
        version={version}
        moreActions={moreActions}
        canShowChanges={!isDeleted}
      />
      {loaded === null ? null : "error" in loaded ? (
        <p className="px-6 py-10 text-center text-ui text-muted-foreground">
          This version couldn't be opened.
        </p>
      ) : (
        <VersionDocument key={loaded.id} value={loaded.value} />
      )}
    </div>
  );
}
