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
  type LocalServer,
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

/** Each local server's name, when it has one. */
export const SERVER_NAMES: Record<LocalServer["kind"], string | null> = {
  ollama: "Ollama",
  lmStudio: "LM Studio",
  llamaCpp: "llama.cpp",
  other: null,
};

/** Whether anything is set up to pick a model from. */
export function isSetUp(provider: AssistantProvider) {
  return (
    provider.key !== null ||
    provider.custom !== null ||
    provider.servers.length > 0
  );
}

/**
 * The lists listed this session, by `sourceKey`, so opening Settings or the
 * picker again doesn't ask every provider again. A list saving a key or
 * address brings replaces its own; Retry asks again.
 */
const listed = new Map<string, AssistantModel[]>();

/** The model lists of set-up providers, by `sourceKey`, listed on demand. */
export function useModelLists() {
  const [models, setModels] = useState<Record<string, Models>>(() =>
    Object.fromEntries(
      [...listed].map(([key, list]) => [key, { state: "ready", models: list }]),
    ),
  );

  const setSource = useCallback((key: string, value: Models | null) => {
    if (value?.state === "ready") listed.set(key, value.models);
    else listed.delete(key);
    setModels((current) => {
      const next = { ...current };
      if (value) next[key] = value;
      else delete next[key];
      return next;
    });
  }, []);

  /** Asks for a source's models, even when they were listed before. */
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

  /** A source's models, from this session's list when there is one. */
  const showModels = useCallback(
    (provider: string, server: string | null = null) => {
      const list = listed.get(sourceKey(provider, server));
      if (list) setSource(sourceKey(provider, server), { state: "ready", models: list });
      else void loadModels(provider, server);
    },
    [loadModels, setSource],
  );

  /** Shows every set-up provider's models. */
  const loadAll = useCallback(
    (providers: AssistantProvider[]) => {
      for (const provider of providers) {
        if (provider.setup === "local") {
          // Listed again each time: a server on this computer may have
          // stopped or started since, and asking it is quick.
          for (const server of provider.servers) {
            void loadModels(provider.id, server.address);
          }
        } else if (isSetUp(provider)) {
          showModels(provider.id);
        }
      }
    },
    [loadModels, showModels],
  );

  /** Drops a removed provider's lists. */
  const forget = useCallback((provider: string) => {
    const gone = (key: string) => key === provider || key.startsWith(`${provider} `);
    for (const key of [...listed.keys()]) if (gone(key)) listed.delete(key);
    setModels((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !gone(key))),
    );
  }, []);

  return { models, setSource, loadModels, loadAll, forget };
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
