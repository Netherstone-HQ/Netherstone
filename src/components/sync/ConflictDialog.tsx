import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Plate, usePlateEditor } from "platejs/react";

import { resolveSessionValue } from "@/components/editor/lib/session-value";
import {
  isInlineElement,
  VersionPreviewKit,
} from "@/components/history/history-diff-kit";
import { Editor as PlateEditor, EditorContainer } from "@/components/ui/editor";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { isMarkdownPath, resolveVaultRelativePath } from "@/lib/drawing-files";
import { errorMessage } from "@/lib/github-account";
import { diffShardValues, sideOf } from "@/lib/history-diff";
import {
  type ConflictChoice,
  type ConflictVersions,
  fileName,
  formatBytes,
  getConflictVersions,
} from "@/lib/sync";
import { useSyncStore } from "@/store/sync";

/**
 * Asks which version to keep for a file that changed both on this device and
 * on GitHub. Until the user decides, this device's version stays in place.
 */
export function ConflictDialog({ vaultPath }: { vaultPath: string }) {
  const resolve = useSyncStore((s) => s.resolve);
  const conflict = useSyncStore((s) => s.openConflict);
  const showConflict = useSyncStore((s) => s.showConflict);
  const onClose = () => showConflict(null);
  const [versions, setVersions] = useState<ConflictVersions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<ConflictChoice | null>(null);

  const path = conflict?.path ?? null;
  useEffect(() => {
    setVersions(null);
    setError(null);
    setChoosing(null);
    if (!path) return;
    let cancelled = false;
    getConflictVersions(vaultPath, path)
      .then((v) => !cancelled && setVersions(v))
      .catch((e) => !cancelled && setError(errorMessage(e)));
    return () => {
      cancelled = true;
    };
  }, [path, vaultPath]);

  async function choose(choice: ConflictChoice) {
    if (!path) return;
    setChoosing(choice);
    await resolve(vaultPath, path, choice);
    onClose();
  }

  const name = path ? fileName(path) : "";
  const dot = name.lastIndexOf(".");
  const copyName =
    dot > 0 ? `${name.slice(0, dot)} (This device)${name.slice(dot)}` : `${name} (This device)`;

  return (
    <Dialog open={conflict !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Choose which version to keep</DialogTitle>
          <DialogDescription>
            <span className="text-foreground">{name}</span> changed on this device
            and on another one. This device's version is in place until you choose.
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="text-destructive text-ui">{error}</p>
        ) : (
          <VersionPair
            filePath={resolveVaultRelativePath(path ?? "", vaultPath)}
            mine={{
              label: "This device",
              text: versions?.thisDevice,
              bytes: versions?.thisDeviceBytes,
            }}
            theirs={{
              label: "GitHub",
              text: versions?.github,
              bytes: versions?.githubBytes,
            }}
            loading={!versions}
          />
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={choosing !== null}
            onClick={() => void choose("both")}
            title={`GitHub's version keeps the name; this device's is saved as ${copyName}`}
          >
            {choosing === "both" ? <LoaderCircleIcon className="animate-spin" /> : null}
            Keep both
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={choosing !== null}
              onClick={() => void choose("gitHub")}
            >
              {choosing === "gitHub" ? <LoaderCircleIcon className="animate-spin" /> : null}
              Keep GitHub version
            </Button>
            <Button disabled={choosing !== null} onClick={() => void choose("thisDevice")}>
              {choosing === "thisDevice" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : null}
              Keep this device's version
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Version = {
  label: string;
  /** `null` when the file isn't text, or is gone. */
  text: string | null | undefined;
  bytes: number | null | undefined;
};

type ShardSides = { key: string; mine: any[]; theirs: any[] };

/**
 * Two versions of a file side by side. A shard shows as it reads, with the
 * words only one version has highlighted and a mark where the other one has
 * something it doesn't; other text shows as it is.
 */
export function VersionPair({
  filePath,
  mine,
  theirs,
  loading,
}: {
  /** Absolute path of the file, for reading a shard's links. */
  filePath: string;
  mine: Version;
  theirs: Version;
  loading: boolean;
}) {
  const isShard = isMarkdownPath(filePath);
  const key = `${filePath}\0${mine.text}\0${theirs.text}`;
  const [sides, setSides] = useState<ShardSides | null>(null);

  useEffect(() => {
    if (!isShard || mine.text == null || theirs.text == null) return;
    let cancelled = false;
    void Promise.all([
      resolveSessionValue(filePath, mine.text, null),
      resolveSessionValue(filePath, theirs.text, null),
    ])
      .then(([mineValue, theirValue]) => {
        if (cancelled) return;
        const merged = diffShardValues(theirValue, mineValue, isInlineElement);
        setSides({
          key,
          mine: sideOf(merged, "current"),
          theirs: sideOf(merged, "version"),
        });
      })
      .catch((error) => {
        console.error("[Netherstone] Couldn't compare the versions:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, isShard, key, mine.text, theirs.text]);

  const shown = sides?.key === key ? sides : null;
  // A shard waits for its comparison; plain text if it can't be had.
  const waiting = loading || (isShard && !shown && mine.text != null && theirs.text != null);

  return (
    <div className="version-pair grid gap-3 sm:grid-cols-2">
      <VersionPane version={mine} value={shown?.mine} loading={waiting} />
      <VersionPane version={theirs} value={shown?.theirs} loading={waiting} />
    </div>
  );
}

function VersionPane({
  version,
  value,
  loading,
}: {
  version: Version;
  value: any[] | undefined;
  loading: boolean;
}) {
  const { label, text, bytes } = version;
  const paneRef = useRef<HTMLDivElement>(null);

  // Opens on the first change, so it's in view without scrolling for it.
  useLayoutEffect(() => {
    paneRef.current
      ?.querySelector(".history-added, .history-gap, .history-gap-block")
      ?.scrollIntoView({ block: "center" });
  }, [value]);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-ui-sm">
        <span className="font-medium">{label}</span>
        {bytes != null ? <span className="text-muted-foreground">{formatBytes(bytes)}</span> : null}
      </div>
      <div ref={paneRef} className="h-56 overflow-auto">
        {loading ? null : value ? (
          <ShardPreview value={value} label={label} />
        ) : text != null ? (
          <pre className="whitespace-pre-wrap break-words p-3 font-mono text-ui-sm leading-5">
            {text}
          </pre>
        ) : (
          <p className="p-3 text-muted-foreground text-ui-sm">
            {bytes == null ? "Not on this device anymore." : "No preview for this file type."}
          </p>
        )}
      </div>
    </div>
  );
}

function ShardPreview({ value, label }: { value: any[]; label: string }) {
  const editor = usePlateEditor({
    plugins: VersionPreviewKit,
    value,
    readOnly: true,
    navigationFeedback: false,
  });
  return (
    <Plate editor={editor} readOnly>
      <EditorContainer variant="default">
        <PlateEditor
          readOnly
          variant="none"
          className="px-3 py-2 font-reading text-ui leading-relaxed"
          aria-label={label}
        />
      </EditorContainer>
    </Plate>
  );
}
