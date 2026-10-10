import { useEffect, useState } from "react";
import { CopyIcon } from "@phosphor-icons/react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { NetherstoneMark } from "@/components/brand/NetherstoneMark";
import {
  PreferenceSwitch,
  SettingRow,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { useKeySequence } from "@/hooks/useKeySequence";
import { installUpdateWithToast } from "@/hooks/useUpdateCheck";
import { bugReportUrl, versionDetails } from "@/lib/bug-report";
import { canUpdate } from "@/lib/updates";
import { useCompanionStore } from "@/store/companion";
import { type UpdateStatus, useUpdatesStore } from "@/store/updates";

const REPOSITORY_URL = "https://github.com/Netherstone-HQ/Netherstone";

const COMPANION_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
  "Enter",
] as const;

async function copyVersionDetails(version: string) {
  try {
    await navigator.clipboard.writeText(
      versionDetails(version, navigator.userAgent),
    );
    toast.success("Copied version details");
  } catch {
    toast.error("Couldn't copy the version details.");
  }
}

export function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null);
  const showCompanion = useCompanionStore((s) => s.show);
  useKeySequence(COMPANION_SEQUENCE, showCompanion);

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
          <div className="flex items-center gap-1">
            <span className="font-mono text-muted-foreground text-sm">
              {version ?? "Unknown"}
            </span>
            {version ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy version details"
                onClick={() => void copyVersionDetails(version)}
              >
                <CopyIcon />
              </Button>
            ) : null}
          </div>
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
          description="Something not working? Let us know. Your version and OS are filled in for you."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void openUrl(
                bugReportUrl(
                  REPOSITORY_URL,
                  version ?? "Unknown",
                  navigator.userAgent,
                ),
              )
            }
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
