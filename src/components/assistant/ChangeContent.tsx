import { useEffect, useState } from "react";
import { Plate, usePlateEditor } from "platejs/react";

import { resolveSessionValue } from "@/components/editor/lib/session-value";
import { VersionPreviewKit } from "@/components/history/history-diff-kit";
import { useThemeMode } from "@/components/theme/theme-provider";
import { Editor as PlateEditor } from "@/components/ui/editor";
import { type ChatChange, previewChange } from "@/lib/commands";
import { previewDrawing } from "@/lib/drawing-exports";
import { resolveVaultRelativePath } from "@/lib/drawing-files";
import { withRemoteMediaAsLinks } from "@/lib/remote-media";
import { useVaultStore } from "@/store/vault";

const FRAME = "max-h-72 overflow-auto rounded-md border bg-background";

function useAfter(change: ChatChange) {
  const [after, setAfter] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    previewChange(change.id).then(
      (preview) => {
        if (!cancelled) setAfter(preview.after);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [change.id, change.count]);
  return { after, failed };
}

function ShardDocument({ value, label }: { value: any[]; label: string }) {
  const editor = usePlateEditor({
    plugins: VersionPreviewKit,
    value,
    readOnly: true,
    navigationFeedback: false,
  });
  return (
    <div className={`${FRAME} px-3 py-2`}>
      <Plate editor={editor} readOnly>
        <PlateEditor
          variant="none"
          className="font-reading! text-ui-sm leading-relaxed"
          readOnly
          aria-label={label}
        />
      </Plate>
    </div>
  );
}

function NewShard({
  text,
  path,
  label,
}: {
  text: string;
  path: string;
  label: string;
}) {
  const vault = useVaultStore((s) => s.currentVaultPath);
  const [value, setValue] = useState<any[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!vault) return;
    const filePath = resolveVaultRelativePath(path, vault);
    void resolveSessionValue(filePath, text, null).then((resolved) => {
      // Nothing from the web loads before it's applied.
      if (!cancelled) setValue(withRemoteMediaAsLinks(resolved as any[]));
    });
    return () => {
      cancelled = true;
    };
  }, [text, path, vault]);
  return value ? <ShardDocument value={value} label={label} /> : null;
}

function Drawing({ json, label }: { json: string; label: string }) {
  const dark = useThemeMode() === "dark";
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    previewDrawing(json, dark).then(
      (blob) => {
        if (cancelled) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [json, dark]);
  if (failed) return <Failed />;
  return url ? (
    <img src={url} alt={label} className={`${FRAME} w-full object-contain`} />
  ) : null;
}

function Failed() {
  return (
    <p className="text-muted-foreground text-ui-sm">
      Couldn't show this change.
    </p>
  );
}

/**
 * What a new shard, or a new or changed drawing, will look like once the
 * change is applied, inside its card.
 */
export function ChangeContent({
  change,
  label,
}: {
  change: ChatChange;
  label: string;
}) {
  const { after, failed } = useAfter(change);
  if (failed) return <Failed />;
  if (after === null) return null;
  return change.kind === "newShard" ? (
    <NewShard text={after} path={change.path} label={label} />
  ) : (
    <Drawing json={after} label={label} />
  );
}
