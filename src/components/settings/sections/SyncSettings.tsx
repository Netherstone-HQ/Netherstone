import { GitHubAccountSection } from "@/components/settings/GitHubAccountSection";
import { SettingsGroup } from "@/components/settings/settings-ui";
import { BackupPanel } from "@/components/sync/BackupPanel";
import { useGitHubStore } from "@/store/github";
import { useVaultStore } from "@/store/vault";

export function SyncSettings() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const signedIn = useGitHubStore((s) => s.account !== null);

  // Everything below the account needs GitHub, so wait for it.
  if (!signedIn) return <GitHubAccountSection />;

  return (
    <>
      <GitHubAccountSection />

      {vaultPath ? (
        <SettingsGroup title="This vault">
          <div className="p-4">
            <BackupPanel vaultPath={vaultPath} showTitle={false} />
          </div>
        </SettingsGroup>
      ) : null}
    </>
  );
}
