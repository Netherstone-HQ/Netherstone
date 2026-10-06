import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";

import { NetherstoneMark } from "@/components/brand/NetherstoneMark";
import {
  PreferenceSwitch,
  SettingRow,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { installUpdateWithToast } from "@/hooks/useUpdateCheck";
import { canUpdate } from "@/lib/updates";
import { type UpdateStatus, useUpdatesStore } from "@/store/updates";

const REPOSITORY_URL = "https://github.com/Netherstone-HQ/Netherstone";

export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    getVersion().then(setVersion, () => setVersion(null));
  }, []);

  return (
    <>
      <div className="flex items-center gap-4 px-1">
        <NetherstoneMark className="size-14" />
        <div className="space-y-0.5">
          <div className="font-semibold text-lg tracking-tight">
            Netherstone
          </div>
          <div className="text-muted-foreground text-sm">
            Your knowledge, set in stone.
          </div>
        </div>
      </div>

      <SettingsGroup>
        <SettingRow label="Version">
          <span className="font-mono text-muted-foreground text-sm">
            {version ?? "Unknown"}
          </span>
        </SettingRow>
        <UpdateRow />
        <PreferenceSwitch
          name="betaUpdates"
          label="Get beta updates"
          description="Try new features before everyone else. Betas can have rough edges."
        />
      </SettingsGroup>

      <SettingsGroup>
        <SettingRow
          label="Source code"
          description="Netherstone is built in the open."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(REPOSITORY_URL)}
          >
            View on GitHub
          </Button>
        </SettingRow>
        <SettingRow
          label="Report a problem"
          description="Something not working? Let us know."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(`${REPOSITORY_URL}/issues/new`)}
          >
            Open an issue
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function updateDescription(status: UpdateStatus): string {
  switch (status.kind) {
    case "idle":
      return "Netherstone checks for updates each time it opens.";
    case "checking":
      return "Checking for updates…";
    case "up-to-date":
      return "You have the latest version.";
    case "available":
      return `Netherstone ${status.update.version} is available.`;
    case "installing":
      return `Updating to Netherstone ${status.update.version}…`;
    case "error":
      return "Couldn't check for updates. Check your connection and try again.";
  }
}

function UpdateRow() {
  const status = useUpdatesStore((s) => s.status);
  const check = useUpdatesStore((s) => s.check);
  if (!canUpdate()) {
    return (
      <SettingRow
        label="Updates"
        description="Updates are turned off in development builds."
      />
    );
  }

  const busy = status.kind === "checking" || status.kind === "installing";

  return (
    <SettingRow label="Updates" description={updateDescription(status)}>
      {status.kind === "available" ? (
        <Button
          size="sm"
          onClick={() => void installUpdateWithToast(status.update.version)}
        >
          Restart to update
        </Button>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void check()}
        >
          Check for updates
        </Button>
      )}
    </SettingRow>
  );
}
