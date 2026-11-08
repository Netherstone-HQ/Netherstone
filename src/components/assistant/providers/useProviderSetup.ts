import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { sourceKey, useModelLists } from "@/components/assistant/models";
import {
  type AssistantModel,
  type AssistantProvider,
  type AssistantStatus,
  type ModelChoice,
  getAssistantStatus,
  removeAssistantProvider,
  setAssistantModel,
} from "@/lib/commands/assistant";

export function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

/** A provider just set up, with the models it offers. */
export interface SavedSource {
  provider: string;
  models: AssistantModel[];
  server?: string;
}

/**
 * The assistant's status and its providers' model lists, with what the
 * provider rows and the model picker do. Settings and the welcome tour
 * share it.
 */
export function useProviderSetup({
  onSaved,
}: {
  /** Runs after a key is saved or a local server found, before the reread. */
  onSaved?: (sources: SavedSource[]) => Promise<void>;
} = {}) {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const { models, setSource, loadModels, loadAll, forget } = useModelLists();

  const refresh = useCallback(async () => {
    try {
      setStatus(await getAssistantStatus());
    } catch (error) {
      showError(error);
    }
  }, []);

  useEffect(() => {
    void getAssistantStatus().then((next) => {
      setStatus(next);
      loadAll(next?.providers ?? []);
    }, showError);
  }, [loadAll]);

  async function pick(choice: ModelChoice) {
    const previous = status?.model ?? null;
    setStatus((current) => current && { ...current, model: choice });
    try {
      await setAssistantModel(choice);
    } catch (error) {
      setStatus((current) => current && { ...current, model: previous });
      showError(error);
    }
  }

  async function remove(provider: AssistantProvider) {
    try {
      await removeAssistantProvider(provider.id);
    } catch (error) {
      showError(error);
      return;
    }
    forget(provider.id);
    await refresh();
  }

  /** Keeps the lists just checked, so they show without asking again. */
  async function saved(sources: SavedSource[]) {
    for (const { provider, models: list, server } of sources) {
      setSource(sourceKey(provider, server), { state: "ready", models: list });
    }
    if (onSaved) await onSaved(sources);
    await refresh();
  }

  return { status, setStatus, models, loadModels, refresh, pick, remove, saved };
}

export type ProviderSetup = ReturnType<typeof useProviderSetup>;
