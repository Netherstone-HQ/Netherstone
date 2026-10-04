import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { toast } from "sonner";

import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { openVaultDialog } from "@/lib/commands";
import { switchVault } from "@/lib/switch-vault";
import { useVaultStore } from "@/store/vault";

const REVEAL_LABEL = navigator.userAgent.includes("Mac")
  ? "Show in Finder"
  : navigator.userAgent.includes("Windows")
    ? "Show in File Explorer"
    : "Show in file manager";

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
              "A vault is a folder of Markdown documents. Open one to get started."
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
          description="Switch to a different folder. This vault stays exactly as it is on disk."
        >
          <Button variant="outline" size="sm" onClick={() => void openOther()}>
            Choose folder
          </Button>
        </SettingRow>
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
      await invoke("index_vault", { vaultPath });
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
      description="Search, tags and links come from an index of your shards. Refresh it if results look out of date."
    >
      <Button
        variant="outline"
        size="sm"
        disabled={working}
        onClick={() => void refresh()}
      >
        {working ? <CircleNotchIcon className="animate-spin" /> : null}
        {working ? "Refreshing" : "Refresh"}
      </Button>
    </SettingRow>
  );
}

async function openOther() {
  const path = await openVaultDialog();
  if (path) await switchVault(path);
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
