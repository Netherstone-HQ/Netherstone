import { useState } from "react";

import {
  type Models,
  SERVER_NAMES,
  errorKind,
  sourceKey,
} from "@/components/assistant/models";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Input } from "@/components/ui/input";
import {
  type AssistantProvider,
  type FoundServer,
  type LocalServer,
  type ProviderError,
  findLocalServers,
  saveLocalServer,
} from "@/lib/commands";
import {
  ErrorLine,
  ProviderRow,
  Saved,
  Spinner,
  errorText,
  hostOf,
  modelCount,
} from "./ProviderRow";
import { showError } from "./useProviderSetup";

function serverName(server: LocalServer): string {
  return SERVER_NAMES[server.kind] ?? hostOf(server.address);
}

export function LocalRow({
  provider,
  models,
  onFound,
  onRetry,
  onRemove,
}: {
  provider: AssistantProvider;
  models: Record<string, Models>;
  onFound: (found: FoundServer[]) => void;
  onRetry: (server: LocalServer) => void;
  onRemove: () => void;
}) {
  const [looking, setLooking] = useState(false);
  const [typing, setTyping] = useState(false);
  const [address, setAddress] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<ProviderError["kind"] | null>(null);

  async function find() {
    setLooking(true);
    try {
      const found = await findLocalServers();
      if (found.length > 0) onFound(found);
      else setTyping(true);
    } catch (e) {
      showError(e);
    } finally {
      setLooking(false);
    }
  }

  async function save() {
    setChecking(true);
    setError(null);
    try {
      const found = await saveLocalServer(address);
      setTyping(false);
      setAddress("");
      onFound([found]);
    } catch (e) {
      const kind = errorKind(e);
      setError(kind === "noModels" ? "unreachable" : kind);
    } finally {
      setChecking(false);
    }
  }

  const servers = provider.servers;
  if (servers.length > 0) {
    const lists = servers.map(
      (server) => models[sourceKey(provider.id, server.address)],
    );
    const down = servers.filter((_, i) => lists[i]?.state === "failed");
    const ready = lists.flatMap((list) =>
      list?.state === "ready" ? list.models : [],
    );
    const loading = lists.some((list) => !list || list.state === "loading");
    return (
      <ProviderRow
        name={provider.name}
        description={
          <Saved live={down.length < servers.length}>
            {servers.map((server, i) => (
              <span key={server.address} className="inline-flex items-center">
                {i > 0 ? <Dot /> : null}
                {serverName(server)}
                {servers.length === 1 && server.kind !== "other" ? (
                  <>
                    <Dot />
                    {hostOf(server.address)}
                  </>
                ) : null}
                {lists[i]?.state === "failed" ? (
                  <>
                    <Dot />
                    Not running
                  </>
                ) : null}
              </span>
            ))}
            {ready.length > 0 || loading ? (
              <>
                <Dot />
                {modelCount(
                  loading
                    ? { state: "loading" }
                    : { state: "ready", models: ready },
                  "",
                )}
              </>
            ) : null}
          </Saved>
        }
        actions={
          <>
            {down.length > 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => down.forEach(onRetry)}
              >
                Look again
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </>
        }
      />
    );
  }

  if (typing) {
    return (
      <ProviderRow name={provider.name}>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim() && !checking) void save();
          }}
        >
          <Input
            type="url"
            autoFocus
            aria-label="Server address"
            aria-invalid={error !== null || undefined}
            placeholder="http://localhost:8080"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setError(null);
            }}
            className="h-9 flex-1"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!address.trim() || checking}
          >
            {checking ? (
              <>
                <Spinner />
                Checking…
              </>
            ) : (
              "Save"
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setTyping(false);
              setAddress("");
              setError(null);
            }}
          >
            Cancel
          </Button>
        </form>
        {error ? (
          <ErrorLine>
            {error === "unreachable"
              ? "Nothing answered at this address"
              : errorText(error, "the server")}
          </ErrorLine>
        ) : (
          <p className="text-muted-foreground text-ui-sm leading-5">
            Nothing running on the usual ports
          </p>
        )}
      </ProviderRow>
    );
  }

  return (
    <ProviderRow
      name={provider.name}
      description="Ollama, LM Studio or llama.cpp"
      actions={
        <Button
          variant="outline"
          size="sm"
          disabled={looking}
          onClick={() => void find()}
        >
          {looking ? (
            <>
              <Spinner />
              Looking…
            </>
          ) : (
            "Find"
          )}
        </Button>
      }
    />
  );
}
