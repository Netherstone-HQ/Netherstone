import { openUrl } from "@tauri-apps/plugin-opener";

import links from "@/data/links.json";
import type { AssistantStatus } from "@/lib/commands";
import { CustomRow } from "./CustomRow";
import { KeyRow } from "./KeyRow";
import { LocalRow } from "./LocalRow";
import { type ProviderSetup, showError } from "./useProviderSetup";

/**
 * The provider rows: the key providers in one card, the local server (and
 * Custom, when `custom`) in another.
 */
export function ProviderCards({
  setup,
  status,
  custom = false,
}: {
  setup: ProviderSetup;
  status: AssistantStatus;
  custom?: boolean;
}) {
  const { models, loadModels, remove, saved } = setup;
  const keyProviders = status.providers.filter((p) => p.setup === "key");
  const otherProviders = status.providers.filter(
    (p) => p.setup === "local" || (custom && p.setup === "custom"),
  );

  return (
    <>
      <div className="divide-y rounded-xl border bg-card shadow-xs">
        {keyProviders.map((provider) => (
          <KeyRow
            key={provider.id}
            provider={provider}
            models={models[provider.id]}
            keyringAvailable={status.keyringAvailable}
            onSaved={(list) => void saved([{ provider: provider.id, models: list }])}
            onRetry={() => void loadModels(provider.id)}
            onRemove={() => void remove(provider)}
          />
        ))}
      </div>
      <div className="divide-y rounded-xl border bg-card shadow-xs">
        {otherProviders.map((provider) =>
          provider.setup === "local" ? (
            <LocalRow
              key={provider.id}
              provider={provider}
              models={models}
              onFound={(found) =>
                void saved(
                  found.map((server) => ({
                    provider: provider.id,
                    models: server.models,
                    server: server.address,
                  })),
                )
              }
              onRetry={(server) => void loadModels(provider.id, server.address)}
              onRemove={() => void remove(provider)}
            />
          ) : (
            <CustomRow
              key={provider.id}
              provider={provider}
              models={models[provider.id]}
              keyringAvailable={status.keyringAvailable}
              onSaved={(list) => void saved([{ provider: provider.id, models: list }])}
              onRemove={() => void remove(provider)}
            />
          ),
        )}
      </div>
    </>
  );
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <button
      type="button"
      onClick={() => void openUrl(href).catch(showError)}
      className="text-foreground underline underline-offset-4 hover:text-foreground/80"
    >
      {children}
    </button>
  );
}

/**
 * Where to start for free. `sentences` runs it on as one paragraph with
 * full stops, the way the welcome tour writes; Settings shows two lines.
 */
export function FreeWaysToStart({ sentences = false }: { sentences?: boolean }) {
  const line = sentences ? undefined : "block";
  const end = sentences ? "." : "";
  return (
    <>
      <span className={line}>
        Free ways to start: a{" "}
        <ExternalLink href={links.googleKeys}>
          Gemini key
        </ExternalLink>
        ,{" "}
        <ExternalLink href={links.openrouterFreeModels}>
          OpenRouter's free models
        </ExternalLink>{" "}
        or a{" "}
        <ExternalLink href={links.ollamaDownload}>
          local server
        </ExternalLink>
        {end}
      </span>
      {sentences ? " " : null}
      <span className={line}>
        Some providers' free plans train their models on your chats{end}
      </span>
    </>
  );
}
