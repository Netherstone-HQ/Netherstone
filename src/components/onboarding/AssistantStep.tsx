import { CircleCheckIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { isSetUp } from "@/components/assistant/models";
import { ModelPicker } from "@/components/assistant/providers/ModelPicker";
import {
  FreeWaysToStart,
  ProviderCards,
} from "@/components/assistant/providers/ProviderCards";
import { ProviderRow } from "@/components/assistant/providers/ProviderRow";
import { useProviderSetup } from "@/components/assistant/providers/useProviderSetup";
import { Button } from "@/components/ui/button";
import {
  getAssistantStatus,
  setAssistantEnabled,
} from "@/lib/commands/assistant";
import { setMcpVaultAllowed } from "@/lib/commands/mcp";
import { folderName } from "@/lib/open-vault";
import { useAssistantStore } from "@/store/assistant";
import { copy } from "./copy";
import { Hint, Step } from "./StepLayout";

async function turnAssistant(enabled: boolean) {
  await setAssistantEnabled(enabled);
  useAssistantStore.getState().setEnabled(enabled);
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/**
 * Offers the assistant with the same provider rows as Settings. A saved key
 * or a found local server turns it on, picks the first model when none is
 * picked yet and turns the vault on for AI.
 */
export function AssistantStep({
  vaultPath,
  onBack,
  onNext,
}: {
  /** The vault picked in the vault step. */
  vaultPath: string;
  onBack: () => void;
  /** `on` says whether the assistant is on, for the last step's tips. */
  onNext: (on: boolean) => void;
}) {
  const setup = useProviderSetup({
    onSaved: async (sources) => {
      try {
        // Read again: another save may have finished since this one began.
        const current = await getAssistantStatus();
        if (!current.enabled) await turnAssistant(true);
        const first = sources.find((source) => source.models.length > 0);
        if (!current.model && first) {
          await setup.pick({
            provider: first.provider,
            model: first.models[0].id,
            server: first.server ?? null,
          });
        }
      } catch (error) {
        showError(error);
      }
    },
  });
  const { status, models, pick } = setup;

  async function skip() {
    try {
      if (status?.enabled) await turnAssistant(false);
    } catch (error) {
      showError(error);
      return;
    }
    onNext(false);
  }

  // Custom isn't offered here, so only the rows shown count.
  const on =
    status !== null &&
    status.enabled &&
    status.providers.some((p) => p.setup !== "custom" && isSetUp(p));

  // The assistant only reads vaults that are on for AI.
  const [vaultOn, setVaultOn] = useState<string | null>(null);
  useEffect(() => {
    if (!on || vaultOn === vaultPath) return;
    let cancelled = false;
    setMcpVaultAllowed(vaultPath, true).then(() => {
      if (!cancelled) setVaultOn(vaultPath);
    }, showError);
    return () => {
      cancelled = true;
    };
  }, [on, vaultPath, vaultOn]);

  return (
    <Step
      title={copy.assistant.title}
      body={copy.assistant.body}
      onBack={onBack}
      action={
        on ? (
          <Button onClick={() => onNext(true)}>{copy.common.continue}</Button>
        ) : (
          <Button variant="outline" onClick={() => void skip()} disabled={!status}>
            {copy.common.skip}
          </Button>
        )
      }
    >
      {status ? (
        <div className="space-y-4">
          {on ? (
            <>
              <p className="onboarding-fade flex items-center gap-3 rounded-xl border bg-card p-4 text-ui">
                <CircleCheckIcon className="size-5" />
                {copy.assistant.on}
              </p>
              <div className="rounded-xl border bg-card shadow-xs">
                <ProviderRow
                  name={copy.assistant.model}
                  actions={
                    <ModelPicker
                      providers={status.providers}
                      models={models}
                      value={status.model}
                      onPick={(choice) => void pick(choice)}
                    />
                  }
                />
              </div>
            </>
          ) : (
            <p className="-mt-4 text-muted-foreground text-ui leading-6">
              <FreeWaysToStart sentences />
            </p>
          )}
          <ProviderCards setup={setup} status={status} />
          {on ? (
            vaultOn === vaultPath ? (
              <Hint>{copy.assistant.vaultOn(folderName(vaultPath))}</Hint>
            ) : null
          ) : (
            <Hint>{copy.assistant.later}</Hint>
          )}
        </div>
      ) : (
        <div className="h-9" />
      )}
    </Step>
  );
}
