import { useCallback, useState } from "react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  type AssistantModel,
  type AssistantProvider,
  type ModelChoice,
  type ProviderError,
  listAssistantModels,
} from "@/lib/commands";

/** A provider's models, or why they couldn't be listed. */
export type Models =
  | { state: "loading" }
  | { state: "ready"; models: AssistantModel[] }
  | { state: "failed"; error: ProviderError["kind"] };

/** Where a list of models comes from: a provider, or one local server. */
export function sourceKey(provider: string, server: string | null = null) {
  return server ? `${provider} ${server}` : provider;
}

export function errorKind(error: unknown): ProviderError["kind"] {
  if (error && typeof error === "object" && "kind" in error) {
    return (error as ProviderError).kind;
  }
  return "failed";
}

export function modelName(model: AssistantModel): string {
  return model.name ?? model.id;
}

/** Whether anything is set up to pick a model from. */
export function isSetUp(provider: AssistantProvider) {
  return (
    provider.key !== null ||
    provider.custom !== null ||
    provider.servers.length > 0
  );
}

/** The model lists of set-up providers, by `sourceKey`, listed on demand. */
export function useModelLists() {
  const [models, setModels] = useState<Record<string, Models>>({});

  const setSource = useCallback((key: string, value: Models | null) => {
    setModels((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);

  const loadModels = useCallback(
    async (provider: string, server: string | null = null) => {
      const key = sourceKey(provider, server);
      setSource(key, { state: "loading" });
      try {
        const list = await listAssistantModels(provider, server);
        setSource(key, { state: "ready", models: list });
      } catch (error) {
        setSource(key, { state: "failed", error: errorKind(error) });
      }
    },
    [setSource],
  );

  /** Lists every set-up provider's models. */
  const loadAll = useCallback(
    (providers: AssistantProvider[]) => {
      for (const provider of providers) {
        if (provider.setup === "local") {
          for (const server of provider.servers) {
            void loadModels(provider.id, server.address);
          }
        } else if (isSetUp(provider)) {
          void loadModels(provider.id);
        }
      }
    },
    [loadModels],
  );

  return { models, setModels, setSource, loadModels, loadAll };
}

/** The models to pick from, grouped by provider. */
export function modelGroups(
  providers: AssistantProvider[],
  models: Record<string, Models>,
) {
  return providers.flatMap((provider) => {
    const sources =
      provider.setup === "local"
        ? provider.servers.map((server) => server.address)
        : [null];
    const items = sources.flatMap((server) => {
      const list = models[sourceKey(provider.id, server)];
      return list?.state === "ready"
        ? list.models.map((model) => ({ model, server }))
        : [];
    });
    return items.length > 0 ? [{ provider, items }] : [];
  });
}

/** The searchable list of models, grouped by provider. */
export function ModelList({
  providers,
  models,
  value,
  onPick,
}: {
  providers: AssistantProvider[];
  models: Record<string, Models>;
  value: ModelChoice | null;
  onPick: (choice: ModelChoice) => void;
}) {
  const groups = modelGroups(providers, models);
  const loading = Object.values(models).some((m) => m.state === "loading");

  return (
    <Command>
      <CommandInput placeholder="Search models" />
      <CommandList>
        <CommandEmpty>
          {loading && groups.length === 0 ? "Listing models" : "No models found"}
        </CommandEmpty>
        {groups.map(({ provider, items }) => (
          <CommandGroup key={provider.id} heading={provider.name}>
            {items.map(({ model, server }) => (
              <CommandItem
                key={`${server ?? ""} ${model.id}`}
                value={`${provider.id} ${server ?? ""} ${model.id}`}
                keywords={[modelName(model), provider.name]}
                data-checked={
                  value?.provider === provider.id &&
                  value.model === model.id &&
                  value.server === server
                }
                onSelect={() =>
                  onPick({ provider: provider.id, server, model: model.id })
                }
              >
                <span className="truncate">{modelName(model)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}
