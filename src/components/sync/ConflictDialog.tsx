import { useEffect, useState } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/lib/github-account";
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
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <VersionPreview
              label="This device"
              text={versions?.thisDevice}
              bytes={versions?.thisDeviceBytes}
              loading={!versions}
            />
            <VersionPreview
              label="GitHub"
              text={versions?.github}
              bytes={versions?.githubBytes}
              loading={!versions}
            />
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            variant="ghost"
            disabled={choosing !== null}
            onClick={() => void choose("both")}
            title={`GitHub's version keeps the name; this device's is saved as ${copyName}`}
          >
            {choosing === "both" ? <CircleNotchIcon className="animate-spin" /> : null}
            Keep both
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button
              variant="outline"
              disabled={choosing !== null}
              onClick={() => void choose("gitHub")}
            >
              {choosing === "gitHub" ? <CircleNotchIcon className="animate-spin" /> : null}
              Keep GitHub version
            </Button>
            <Button disabled={choosing !== null} onClick={() => void choose("thisDevice")}>
              {choosing === "thisDevice" ? (
                <CircleNotchIcon className="animate-spin" />
              ) : null}
              Keep this device's version
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VersionPreview({
  label,
  text,
  bytes,
  loading,
}: {
  label: string;
  text: string | null | undefined;
  bytes: number | null | undefined;
  loading: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5 text-xs">
        <span className="font-medium">{label}</span>
        {bytes != null ? <span className="text-muted-foreground">{formatBytes(bytes)}</span> : null}
      </div>
      <div className="h-56 overflow-auto p-3">
        {loading ? null : text != null ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">{text}</pre>
        ) : (
          <p className="text-muted-foreground text-xs">
            {bytes == null ? "Not on this device anymore." : "No preview for this file type."}
          </p>
        )}
      </div>
    </div>
  );
}
