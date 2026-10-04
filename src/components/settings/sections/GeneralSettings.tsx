import { useState } from "react";
import { toast } from "sonner";

import {
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
          description="Pick up where you left off when Netherstone opens."
        />
        <WelcomeRow />
      </SettingsGroup>

      <SettingsGroup title="Sidebar">
        <RecentShardsRows />
      </SettingsGroup>

      <SettingsGroup title="Deleting">
        <PreferenceSwitch
          name="confirmBeforeDelete"
          label="Ask before moving to Trash"
          description="Deleted shards and folders go to your system Trash."
        />
      </SettingsGroup>

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
        description="List the shards you opened last above your files."
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

function WelcomeRow() {
  const resetOnboarding = useSettingsStore((s) => s.resetOnboarding);

  return (
    <SettingRow
      label="Welcome tour"
      description="Go through the first-run setup again: configure your vault, customize Netherstone's look and set up sync."
    >
      <Button variant="outline" size="sm" onClick={resetOnboarding}>
        Show welcome again
      </Button>
    </SettingRow>
  );
}

function ResetRow() {
  const [open, setOpen] = useState(false);
  const resetSettings = useSettingsStore((s) => s.resetSettings);

  return (
    <SettingRow
      label="Restore default settings"
      description="Puts every setting back the way it was on first install. Your vault, shards and sync setup stay as they are."
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Restore defaults
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore default settings?</AlertDialogTitle>
            <AlertDialogDescription>
              Every setting goes back to default. Your vault, shards and sync
              aren't affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetSettings();
                toast("Settings restored to their defaults.");
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
