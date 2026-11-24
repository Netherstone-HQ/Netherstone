import { useState } from "react";
import { EllipsisIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { IS_PHONE } from "@/components/phone/phone-shell";
import { ActionsMenu, type RowAction } from "@/components/vault/RowActions";
import { formatVersionTitle, type FileVersion } from "@/lib/history";
import { restoreFileVersion } from "@/lib/history-restore";
import { useHistoryStore } from "@/store/history";

/**
 * Takes the editor toolbar's place while an earlier version is on screen:
 * which version it is, whether its changes show, and restoring it.
 */
export function VersionBar({
  version,
  moreActions,
  canShowChanges = true,
}: {
  version: FileVersion;
  moreActions: RowAction[];
  /** False when there's nothing now to compare with, as for a deleted shard. */
  canShowChanges?: boolean;
}) {
  const showChanges = useHistoryStore((s) => s.showChanges);
  const setShowChanges = useHistoryStore((s) => s.setShowChanges);
  const { restore, isRestoring } = useRestore(version);

  const more = (
    <ActionsMenu actions={moreActions}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="More"
        className="size-8 text-muted-foreground"
      >
        <EllipsisIcon />
      </Button>
    </ActionsMenu>
  );

  // On a phone the top bar names the version and Restore sits at the bottom.
  if (IS_PHONE) {
    return (
      <div className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        {canShowChanges ? (
          <label className="flex items-center gap-3">
            <Switch
              checked={showChanges}
              onCheckedChange={setShowChanges}
              className="data-[state=checked]:bg-brand"
            />
            Show changes
          </label>
        ) : null}
        <div className="ml-auto">{more}</div>
      </div>
    );
  }

  return (
    <div className="flex h-toolbar shrink-0 items-center gap-3 border-b bg-card pr-4 pl-5 text-ui">
      <span className="min-w-0 truncate font-medium">
        {formatVersionTitle(version.time)}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {canShowChanges ? (
          <label className="flex cursor-pointer items-center gap-2 text-ui-sm text-muted-foreground">
            <Switch
              checked={showChanges}
              onCheckedChange={setShowChanges}
              className="data-[state=checked]:bg-brand"
            />
            Show changes
          </label>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => void restore()}
          disabled={isRestoring}
        >
          <RotateCcwIcon />
          Restore this version
        </Button>
        {more}
      </div>
    </div>
  );
}

function useRestore(version: FileVersion) {
  const [isRestoring, setIsRestoring] = useState(false);
  const restore = async () => {
    setIsRestoring(true);
    try {
      await restoreFileVersion(version);
    } finally {
      setIsRestoring(false);
    }
  };
  return { restore, isRestoring };
}

/** Restore along the bottom of a phone's version screen. */
export function PhoneRestoreBar({ version }: { version: FileVersion }) {
  const { restore, isRestoring } = useRestore(version);
  return (
    <div className="shrink-0 border-t px-4 py-3">
      <Button
        type="button"
        className="h-12 w-full text-base"
        onClick={() => void restore()}
        disabled={isRestoring}
      >
        Restore this version
      </Button>
    </div>
  );
}
