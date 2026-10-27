import { useEffect, useId, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { HelpDialog } from "@/components/settings/HelpDialog";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type AiApp,
  connectAiApp,
  getMcpEnabled,
  getMcpSetup,
  listAiApps,
  listMcpVaults,
  type McpVault,
  setMcpEnabled,
  setMcpVaultAllowed,
} from "@/lib/commands";

export function AiAppsSettings() {
  const switchId = useId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [apps, setApps] = useState<AiApp[]>([]);
  const [vaults, setVaults] = useState<McpVault[]>([]);

  useEffect(() => {
    void getMcpEnabled().then(setEnabled, showError);
    void listAiApps().then(setApps, showError);
    void listMcpVaults().then(setVaults, showError);
  }, []);

  async function allowVault(vault: McpVault, allowed: boolean) {
    const set = (value: boolean) =>
      setVaults((current) =>
        current.map((v) =>
          v.path === vault.path ? { ...v, allowed: value } : v,
        ),
      );
    set(allowed);
    try {
      await setMcpVaultAllowed(vault.path, allowed);
    } catch (error) {
      set(!allowed);
      showError(error);
    }
  }

  async function toggle(next: boolean) {
    setEnabled(next);
    try {
      await setMcpEnabled(next);
    } catch (error) {
      setEnabled(!next);
      showError(error);
    }
  }

  async function connect(app: AiApp) {
    try {
      await connectAiApp(app.id);
      toast.success(`Restart ${app.name} to use your vault`);
    } catch {
      toast.error(`Couldn't connect ${app.name}`);
    }
    await listAiApps().then(setApps, showError);
  }

  async function copySetup() {
    try {
      await navigator.clipboard.writeText(await getMcpSetup());
      toast.success("Setup copied");
    } catch {
      toast.error("Couldn't copy the setup");
    }
  }

  const off = enabled !== true;
  // Apps on this computer first, then the ones to download.
  const appGroups = [
    apps.filter((app) => app.installed || app.connected),
    apps.filter((app) => !app.installed && !app.connected),
  ].filter((group) => group.length > 0);

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label="Connect your AI apps"
          description={
            <span className="inline-flex items-center gap-1.5">
              Let AI apps find, read and write shards in the vaults you pick
              <HelpDialog
                title="How AI apps use your vault"
                description="They only see the vaults you turn on here"
              >
                <p>Changes are saved in History first, so you can undo them</p>
                <p>They can't delete anything</p>
              </HelpDialog>
            </span>
          }
          htmlFor={switchId}
        >
          <Switch
            id={switchId}
            checked={enabled === true}
            disabled={enabled === null}
            onCheckedChange={(checked) => void toggle(checked)}
          />
        </SettingRow>
      </SettingsGroup>

      {vaults.length > 0 ? (
        <SettingsGroup title="Vaults">
          {vaults.map((vault) => (
            <VaultRow
              key={vault.path}
              vault={vault}
              disabled={off}
              onChange={(allowed) => void allowVault(vault, allowed)}
            />
          ))}
        </SettingsGroup>
      ) : null}

      {appGroups.map((group, i) => (
        <SettingsGroup key={group[0].id} title={i === 0 ? "Apps" : undefined}>
          {group.map((app) => (
            <SettingRow key={app.id} label={app.name}>
              <AppButton
                app={app}
                disabled={off}
                onConnect={() => connect(app)}
              />
            </SettingRow>
          ))}
        </SettingsGroup>
      ))}

      <SettingsGroup title={appGroups.length === 0 ? "Apps" : undefined}>
        <SettingRow label="Other apps">
          <Button
            variant="outline"
            size="sm"
            disabled={off}
            onClick={() => void copySetup()}
          >
            Copy setup
          </Button>
        </SettingRow>
      </SettingsGroup>
    </>
  );
}

function VaultRow({
  vault,
  disabled,
  onChange,
}: {
  vault: McpVault;
  disabled: boolean;
  onChange: (allowed: boolean) => void;
}) {
  const id = useId();
  return (
    <SettingRow
      label={vault.name}
      description={<span className="break-all font-mono">{vault.path}</span>}
      htmlFor={id}
    >
      <Switch
        id={id}
        checked={vault.allowed}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </SettingRow>
  );
}

function AppButton({
  app,
  disabled,
  onConnect,
}: {
  app: AiApp;
  disabled: boolean;
  onConnect: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);

  if (!app.installed && !app.connected) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => void openUrl(app.downloadUrl).catch(showError)}
      >
        Download
      </Button>
    );
  }
  if (app.connected) {
    return (
      <Button variant="outline" size="sm" disabled>
        <CheckIcon />
        Connected
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled || working}
      onClick={() => {
        setWorking(true);
        void onConnect().finally(() => setWorking(false));
      }}
    >
      {working ? <LoaderCircleIcon className="animate-spin" /> : null}
      Connect
    </Button>
  );
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}
