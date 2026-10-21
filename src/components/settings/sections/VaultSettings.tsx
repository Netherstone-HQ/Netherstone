import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import {
  PreferenceSegments,
  SettingRow,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { openVaultDialog } from "@/lib/commands";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { openVault } from "@/lib/open-vault";
import { REVEAL_LABEL } from "@/lib/platform";
import { indexVault } from "@/lib/refresh-vault";
import { useVaultStore } from "@/store/vault";

export function VaultSettings() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);

  return (
    <>
      <SettingsGroup title="Location">
        <SettingRow
          label={vaultPath ? vaultName(vaultPath) : "No vault open"}
          description={
            vaultPath ? (
              <span className="break-all font-mono">{vaultPath}</span>
            ) : (
              "Any folder works, even an empty one."
            )
          }
        >
          {vaultPath ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void revealItemInDir(vaultPath).catch(showError)}
            >
              {REVEAL_LABEL}
            </Button>
          ) : null}
        </SettingRow>
        <SettingRow
          label="Open another vault"
          description="Switch to a different folder."
        >
          <Button variant="outline" size="sm" onClick={() => void openOther()}>
            Choose folder
          </Button>
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="New shards">
        <PreferenceSegments
          name="newShardLocation"
          label="Create new shards in"
          description="Where a shard goes when you create it from the sidebar or header."
          options={[
            { value: "vault-root", label: "Top of the vault" },
            { value: "current-folder", label: "Current folder" },
          ]}
        />
      </SettingsGroup>

      {vaultPath ? (
        <SettingsGroup title="Search">
          <RefreshIndexRow vaultPath={vaultPath} />
        </SettingsGroup>
      ) : null}
    </>
  );
}

function RefreshIndexRow({ vaultPath }: { vaultPath: string }) {
  const [working, setWorking] = useState(false);

  async function refresh() {
    setWorking(true);
    try {
      await indexVault(vaultPath);
      toast("Search index is up to date.");
    } catch (error) {
      showError(error);
    } finally {
      setWorking(false);
    }
  }

  return (
    <SettingRow
      label="Refresh search index"
      description="Use it when search, tags or links look out of date."
    >
      <Button
        variant="outline"
        size="sm"
        disabled={working}
        onClick={() => void refresh()}
      >
        {working ? <LoaderCircleIcon className="animate-spin" /> : null}
        {working ? "Refreshing" : "Refresh"}
      </Button>
    </SettingRow>
  );
}

async function openOther() {
  const picked = await openVaultDialog();
  const path = picked && (await chooseVaultFolder(picked, "open"));
  if (path) await openVault(path).catch(showError);
}

function vaultName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}
