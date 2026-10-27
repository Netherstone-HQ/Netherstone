import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import {
  PreferenceSegments,
  PreferenceSwitch,
  SettingRow,
  SettingsGroup,
  Stepper,
} from "@/components/settings/settings-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  getIntegrations,
  setIntegration,
  type Integration,
  type Integrations,
} from "@/lib/commands";
import {
  MAX_RECENT_FILES_LIMIT,
  MIN_RECENT_FILES_LIMIT,
  useSettingsStore,
} from "@/store/settings";

export function GeneralSettings() {
  return (
    <>
      <SettingsGroup title="Startup">
        <PreferenceSwitch
          name="reopenLastShard"
          label="Reopen your last shard"
          description="Pick up where you left off when Netherstone opens"
        />
      </SettingsGroup>

      <SettingsGroup title="Sidebar">
        <RecentShardsRows />
      </SettingsGroup>

      <SettingsGroup title="Links">
        <PreferenceSegments
          name="openLinksIn"
          label="Open links in"
          options={[
            { value: "browser-panel", label: "Browser panel" },
            { value: "your-browser", label: "Your browser" },
          ]}
        />
      </SettingsGroup>

      <SettingsGroup title="Deleting">
        <PreferenceSwitch
          name="confirmBeforeDelete"
          label="Ask before moving to trash"
          description="Deleted shards and folders go to your system trash"
        />
      </SettingsGroup>

      <SystemRows />

      <SettingsGroup title="Reset">
        <ResetRow />
      </SettingsGroup>
    </>
  );
}

function RecentShardsRows() {
  const show = useSettingsStore((s) => s.showRecentFiles);
  const limit = useSettingsStore((s) => s.recentFilesLimit);
  const setPreference = useSettingsStore((s) => s.setPreference);

  return (
    <>
      <PreferenceSwitch
        name="showRecentFiles"
        label="Show recent shards"
        description="List the shards you opened last above your files"
      />
      {show ? (
        <SettingRow label="Number of recent shards">
          <Stepper
            label="Number of recent shards"
            value={limit}
            min={MIN_RECENT_FILES_LIMIT}
            max={MAX_RECENT_FILES_LIMIT}
            onChange={(next) => setPreference("recentFilesLimit", next)}
          />
        </SettingRow>
      ) : null}
    </>
  );
}

const INTEGRATIONS: { integration: Integration; label: string; description: string }[] = [
  {
    integration: "openWith",
    label: "Show in Open with",
    description: "List Netherstone when opening Markdown, text, PDF, Word and web pages",
  },
  {
    integration: "folderMenu",
    label: "Open folders as vaults",
    description: "Add Open as Netherstone vault to the folder menu",
  },
  {
    integration: "terminal",
    label: "Terminal command",
    description: "Open folders and files from the terminal with netherstone",
  },
];

/** What the system offers: none on Linux, where the package sets them up. */
function SystemRows() {
  const [on, setOn] = useState<Integrations | null>(null);

  useEffect(() => {
    getIntegrations()
      .then(setOn)
      .catch(() => setOn(null));
  }, []);

  const offered = INTEGRATIONS.filter(({ integration }) => on?.[integration] != null);
  if (!on || !offered.length) return null;

  return (
    <SettingsGroup title="System">
      {offered.map((row) => (
        <IntegrationRow
          key={row.integration}
          {...row}
          on={!!on[row.integration]}
          onChange={(next) => setOn((now) => now && { ...now, [row.integration]: next })}
        />
      ))}
    </SettingsGroup>
  );
}

function IntegrationRow({
  integration,
  label,
  description,
  on,
  onChange,
}: {
  integration: Integration;
  label: string;
  description: string;
  on: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  const [isWorking, setIsWorking] = useState(false);

  const change = async (next: boolean) => {
    setIsWorking(true);
    try {
      await setIntegration(integration, next);
      onChange(next);
    } catch (error) {
      console.error(`[Netherstone] Couldn't change ${integration}:`, error);
      toast.error(`Couldn't change ${label.toLowerCase()}`);
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <SettingRow label={label} description={description} htmlFor={id}>
      <Switch id={id} checked={on} disabled={isWorking} onCheckedChange={(next) => void change(next)} />
    </SettingRow>
  );
}

function ResetRow() {
  const [open, setOpen] = useState(false);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  return (
    <SettingRow
      label="Restore default settings"
      description="Your vault, shards and sync stay as they are"
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Restore defaults
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore default settings?</AlertDialogTitle>
            <AlertDialogDescription>
              Every setting goes back to default, and your vault, shards and
              sync stay as they are
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetSettings();
                toast("Settings restored to their defaults");
              }}
            >
              Restore defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingRow>
  );
}
