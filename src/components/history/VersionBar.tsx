import { useState } from "react";
import { EllipsisIcon, RotateCcwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
  const [isRestoring, setIsRestoring] = useState(false);

  const restore = async () => {
    setIsRestoring(true);
    try {
      await restoreFileVersion(version);
    } finally {
      setIsRestoring(false);
    }
  };

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
      </div>
    </div>
  );
}
