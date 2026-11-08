import { useId, useState } from "react";

import { DeleteAllChatsDialog } from "@/components/assistant/ChatsMenu";
import { HelpDialog } from "@/components/settings/HelpDialog";
import { MemorySection } from "@/components/settings/MemorySection";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  type AssistantStatus,
  setAssistantEnabled,
  setAssistantSendFiles,
} from "@/lib/commands/assistant";
import { useAssistantStore } from "@/store/assistant";
import { ModelPicker } from "@/components/assistant/providers/ModelPicker";
import {
  FreeWaysToStart,
  ProviderCards,
} from "@/components/assistant/providers/ProviderCards";
import {
  showError,
  useProviderSetup,
} from "@/components/assistant/providers/useProviderSetup";

/** Where a shard's images and PDFs go with it: wherever the model runs. */
function filesGoTo(status: AssistantStatus) {
  const provider = status.providers.find((p) => p.id === status.model?.provider);
  if (provider?.setup === "local") {
    return "They go to your local server with the shard's text and stay on this computer";
  }
  if (provider?.setup === "custom") {
    return "They go to your custom server with the shard's text";
  }
  if (provider) return `They go to ${provider.name} with the shard's text`;
  return "They go to the model's provider with the shard's text";
}

export function AiAssistantSettings() {
  const switchId = useId();
  const filesId = useId();
  const [confirming, setConfirming] = useState(false);
  const setup = useProviderSetup();
  const { status, setStatus, models, pick } = setup;

  if (!status) return null;

  async function toggle(enabled: boolean) {
    setStatus((current) => current && { ...current, enabled });
    try {
      await setAssistantEnabled(enabled);
      useAssistantStore.getState().setEnabled(enabled);
    } catch (error) {
      setStatus((current) => current && { ...current, enabled: !enabled });
      showError(error);
    }
  }

  async function toggleFiles(sendFiles: boolean) {
    setStatus((current) => current && { ...current, sendFiles });
    try {
      await setAssistantSendFiles(sendFiles);
    } catch (error) {
      setStatus((current) => current && { ...current, sendFiles: !sendFiles });
      showError(error);
    }
  }

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label="Turn on the assistant"
          description={
            <span className="inline-flex items-center gap-1.5">
              Ask about your vault and change shards from a side panel
              <HelpDialog
                title="How the assistant uses your vault"
                description="It only sees the vaults you turn on in AI apps"
              >
                <p>
                  What you ask and the shards it reads go to the provider you
                  pick
                </p>
                <p>It shows each change in the shard before you apply it</p>
              </HelpDialog>
            </span>
          }
          htmlFor={switchId}
        >
          <Switch
            id={switchId}
            checked={status.enabled}
            onCheckedChange={(checked) => void toggle(checked)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Model">
        <SettingRow label="Model">
          <ModelPicker
            providers={status.providers}
            models={models}
            value={status.model}
            onPick={(choice) => void pick(choice)}
          />
        </SettingRow>
        <SettingRow
          label="Send images and PDFs"
          description={filesGoTo(status)}
          htmlFor={filesId}
        >
          <Switch
            id={filesId}
            checked={status.sendFiles}
            onCheckedChange={(checked) => void toggleFiles(checked)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Chats">
        <SettingRow
          label="Saved chats"
          description="Kept on this computer, outside your vaults and sync"
        >
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirming(true)}
          >
            Delete all
          </Button>
          <DeleteAllChatsDialog
            open={confirming}
            onOpenChange={setConfirming}
          />
        </SettingRow>
      </SettingsGroup>

      <MemorySection />

      <SettingsGroup title="Providers" description={<FreeWaysToStart />} bare>
        <div className="space-y-5">
          <ProviderCards setup={setup} status={status} custom />
        </div>
      </SettingsGroup>
    </>
  );
}
