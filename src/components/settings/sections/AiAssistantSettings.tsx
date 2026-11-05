import { useCallback, useEffect, useId, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  type Models,
  ModelList,
  errorKind,
  modelGroups,
  modelName,
  sourceKey,
  useModelLists,
} from "@/components/assistant/models";
import { DeleteAllChatsDialog } from "@/components/assistant/ChatsMenu";
import { HelpDialog } from "@/components/settings/HelpDialog";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dot } from "@/components/ui/dot";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type AssistantApi,
  type AssistantModel,
  type AssistantProvider,
  type AssistantStatus,
  type FoundServer,
  type KeyStorage,
  type LocalServer,
  type ModelChoice,
  type ProviderError,
  findLocalServers,
  getAssistantStatus,
  removeAssistantProvider,
  saveAssistantKey,
  saveCustomProvider,
  saveLocalServer,
  setAssistantEnabled,
  setAssistantModel,
  setAssistantSendFiles,
} from "@/lib/commands";
import { useAssistantStore } from "@/store/assistant";
import { cn } from "@/lib/utils";

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

const SERVER_NAMES: Record<LocalServer["kind"], string | null> = {
  ollama: "Ollama",
  lmStudio: "LM Studio",
  llamaCpp: "llama.cpp",
  other: null,
};

function hostOf(address: string): string {
  return address.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function serverName(server: LocalServer): string {
  return SERVER_NAMES[server.kind] ?? hostOf(server.address);
}

const API_OPTIONS: { value: AssistantApi; label: string }[] = [
  { value: "openAi", label: "OpenAI-style" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
];

export function AiAssistantSettings() {
  const switchId = useId();
  const filesId = useId();
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const { models, setModels, setSource, loadModels, loadAll } =
    useModelLists();

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
    setModels((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => key !== provider.id && !key.startsWith(`${provider.id} `),
        ),
      ),
    );
    await refresh();
  }

  /** Keeps a list just checked, so it shows without asking again. */
  function saved(provider: string, list: AssistantModel[], server?: string) {
    setSource(sourceKey(provider, server), { state: "ready", models: list });
    void refresh();
  }

  const keyProviders = status.providers.filter((p) => p.setup === "key");
  const otherProviders = status.providers.filter((p) => p.setup !== "key");

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
          description="They leave this computer with the shard's text"
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

      <SettingsGroup title="Providers" description={<FreeWaysToStart />} bare>
        <div className="space-y-5">
          <div className="divide-y rounded-xl border bg-card shadow-xs">
            {keyProviders.map((provider) => (
              <KeyRow
                key={provider.id}
                provider={provider}
                models={models[provider.id]}
                keyringAvailable={status.keyringAvailable}
                onSaved={(list) => saved(provider.id, list)}
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
                  onFound={(found) => {
                    for (const server of found) {
                      saved(provider.id, server.models, server.address);
                    }
                  }}
                  onRetry={(server) =>
                    void loadModels(provider.id, server.address)
                  }
                  onRemove={() => void remove(provider)}
                />
              ) : (
                <CustomRow
                  key={provider.id}
                  provider={provider}
                  models={models[provider.id]}
                  keyringAvailable={status.keyringAvailable}
                  onSaved={(list) => saved(provider.id, list)}
                  onRemove={() => void remove(provider)}
                />
              ),
            )}
          </div>
        </div>
      </SettingsGroup>
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

function FreeWaysToStart() {
  return (
    <>
      <span className="block">
        Free ways to start: a{" "}
        <ExternalLink href="https://aistudio.google.com/apikey">
          Gemini key
        </ExternalLink>
        ,{" "}
        <ExternalLink href="https://openrouter.ai/models?max_price=0">
          OpenRouter's free models
        </ExternalLink>{" "}
        or a{" "}
        <ExternalLink href="https://ollama.com/download">
          local server
        </ExternalLink>
      </span>
      <span className="block">
        Free tiers may use your chats to train models
      </span>
    </>
  );
}

function ModelPicker({
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
  const [open, setOpen] = useState(false);
  const groups = modelGroups(providers, models);

  const picked = value
    ? groups
        .find((group) => group.provider.id === value.provider)
        ?.items.find(
          (item) =>
            item.model.id === value.model && item.server === value.server,
        )
    : undefined;
  const pickedProvider = providers.find((p) => p.id === value?.provider);
  const empty = groups.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Model"
          disabled={empty && !value}
          className="flex h-8 w-75 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-ui shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 dark:hover:bg-input/50"
        >
          <span className="flex min-w-0 items-center gap-2">
            {value ? (
              <>
                <span className="truncate">
                  {picked ? modelName(picked.model) : value.model}
                </span>
                <span className="shrink-0 text-muted-foreground text-ui-sm">
                  {pickedProvider?.setup === "local"
                    ? "Local"
                    : pickedProvider?.name}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                {empty ? "No models yet" : "Pick a model"}
              </span>
            )}
          </span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-75 p-0">
        <ModelList
          providers={providers}
          models={models}
          value={value}
          onPick={(choice) => {
            onPick(choice);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

function Spinner() {
  return <LoaderCircleIcon className="size-4 animate-spin" />;
}

/** What a saved provider says next to its name. */
function Saved({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex flex-wrap items-center">
      <span className="mr-2 inline-block size-1.5 rounded-full bg-emerald-500" />
      {children}
    </span>
  );
}

function modelCount(
  models: Models | undefined,
  failed: string,
): React.ReactNode {
  if (!models || models.state === "loading") return "Listing models";
  if (models.state === "failed") return failed;
  const count = models.models.length;
  return count === 1 ? "1 model" : `${count} models`;
}

function storageLine(storage: KeyStorage | null): string | null {
  if (storage === "file") {
    return "This computer has no keyring, so the key is in a file only you can open";
  }
  if (storage === "memory") {
    return "You'll add it again next time you open Netherstone";
  }
  return null;
}

/** The words for why a provider couldn't be used. */
function errorText(kind: ProviderError["kind"], name: string): string {
  switch (kind) {
    case "keyRefused":
      return `${name} didn't accept this key`;
    case "unreachable":
      return `Couldn't reach ${name}`;
    case "rateLimited":
      return `${name} is busy, try again in a moment`;
    case "noModels":
      return "No models found at this address";
    case "insecure":
      return "Use an https address to send a key to another computer";
    case "notLocal":
      return "Use an address on this computer, or set it up as Custom";
    case "badAddress":
      return "This isn't a web address";
    case "storage":
      return "Couldn't save the key on this computer";
    case "failed":
      return `Something went wrong with ${name}`;
  }
}

/** Shown without a keyring: whether to keep keys in a file or this run only. */
function RememberChoice({
  remember,
  onChange,
}: {
  remember: boolean;
  onChange: (remember: boolean) => void;
}) {
  const id = useId();
  return (
    <Label htmlFor={id} className="font-normal">
      <Checkbox
        id={id}
        checked={remember}
        onCheckedChange={(checked) => onChange(checked === true)}
      />
      Keep the key on this computer
    </Label>
  );
}

function ProviderRow({
  name,
  description,
  actions,
  children,
}: {
  name: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="font-medium text-ui">{name}</div>
          {description ? (
            <div className="space-y-0.5 text-muted-foreground text-ui-sm leading-5">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children ? <div className="space-y-2 px-4 pb-4">{children}</div> : null}
    </div>
  );
}

function ErrorLine({ children }: { children: React.ReactNode }) {
  return <p className="text-destructive text-ui-sm leading-5">{children}</p>;
}

function KeyRow({
  provider,
  models,
  keyringAvailable,
  onSaved,
  onRetry,
  onRemove,
}: {
  provider: AssistantProvider;
  models: Models | undefined;
  keyringAvailable: boolean;
  onSaved: (models: AssistantModel[]) => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [remember, setRemember] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<ProviderError["kind"] | null>(null);

  function close() {
    setEditing(false);
    setDraft("");
    setError(null);
  }

  async function save() {
    setChecking(true);
    setError(null);
    try {
      const list = await saveAssistantKey(provider.id, draft, remember);
      close();
      onSaved(list);
    } catch (e) {
      setError(errorKind(e));
    } finally {
      setChecking(false);
    }
  }

  if (provider.key) {
    const storage = storageLine(provider.key);
    const failed = models?.state === "failed";
    return (
      <ProviderRow
        name={provider.name}
        description={
          <>
            <div>
              <Saved>
                Key saved
                <Dot />
                {modelCount(
                  models,
                  failed ? errorText(models.error, provider.name) : "",
                )}
              </Saved>
            </div>
            {storage ? <div>{storage}</div> : null}
          </>
        }
        actions={
          <>
            {failed ? (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
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

  if (!editing) {
    return (
      <ProviderRow
        name={provider.name}
        actions={
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            Add key
          </Button>
        }
      />
    );
  }

  const keyPage = provider.keyPage;
  return (
    <ProviderRow
      name={provider.name}
      actions={
        keyPage ? (
          <button
            type="button"
            onClick={() => void openUrl(keyPage).catch(showError)}
            className="inline-flex items-center gap-1 text-ui-sm text-primary hover:underline"
          >
            Get a key
            <ArrowUpRightIcon className="size-3.5" />
          </button>
        ) : null
      }
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !checking) void save();
        }}
      >
        <Input
          type="password"
          autoFocus
          aria-label={`${provider.name} key`}
          aria-invalid={error === "keyRefused" || undefined}
          placeholder={`Paste your ${provider.name} key`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          className="h-9 flex-1"
        />
        <Button type="submit" size="sm" disabled={!draft.trim() || checking}>
          {checking ? (
            <>
              <Spinner />
              Checking…
            </>
          ) : error === "unreachable" ? (
            "Try again"
          ) : (
            "Save"
          )}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={close}>
          Cancel
        </Button>
      </form>
      {error ? <ErrorLine>{errorText(error, provider.name)}</ErrorLine> : null}
      {keyringAvailable ? null : (
        <RememberChoice remember={remember} onChange={setRemember} />
      )}
    </ProviderRow>
  );
}

function LocalRow({
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
          <Saved>
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

function CustomRow({
  provider,
  models,
  keyringAvailable,
  onSaved,
  onRemove,
}: {
  provider: AssistantProvider;
  models: Models | undefined;
  keyringAvailable: boolean;
  onSaved: (models: AssistantModel[]) => void;
  onRemove: () => void;
}) {
  const addressId = useId();
  const apiId = useId();
  const keyId = useId();
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState("");
  const [api, setApi] = useState<AssistantApi>("openAi");
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<ProviderError["kind"] | null>(null);

  function open() {
    setAddress(provider.custom?.address ?? "");
    setApi(provider.custom?.api ?? "openAi");
    setKey("");
    setError(null);
    setEditing(true);
  }

  async function save() {
    setChecking(true);
    setError(null);
    try {
      const list = await saveCustomProvider(
        address,
        api,
        key || null,
        remember,
      );
      setEditing(false);
      setKey("");
      onSaved(list);
    } catch (e) {
      setError(errorKind(e));
    } finally {
      setChecking(false);
    }
  }

  if (editing) {
    const addressError =
      error === "insecure" ||
      error === "noModels" ||
      error === "badAddress" ||
      error === "unreachable";
    return (
      <ProviderRow name={provider.name}>
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (address.trim() && !checking) void save();
          }}
        >
          <div className="flex items-center gap-2">
            <Label
              htmlFor={addressId}
              className="w-16 shrink-0 font-normal text-muted-foreground text-ui-sm"
            >
              Address
            </Label>
            <Input
              id={addressId}
              type="url"
              autoFocus
              aria-invalid={addressError || undefined}
              placeholder="https://api.example.com/v1"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setError(null);
              }}
              className="h-9 flex-1"
            />
          </div>
          {addressError ? (
            <div className="pl-18">
              <ErrorLine>{errorText(error, "this address")}</ErrorLine>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <Label
              htmlFor={apiId}
              className="w-16 shrink-0 font-normal text-muted-foreground text-ui-sm"
            >
              Speaks
            </Label>
            <Select
              value={api}
              onValueChange={(next) => setApi(next as AssistantApi)}
            >
              <SelectTrigger id={apiId} size="sm" className="min-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {API_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Label
              htmlFor={keyId}
              className="w-16 shrink-0 font-normal text-muted-foreground text-ui-sm"
            >
              Key
            </Label>
            <Input
              id={keyId}
              type="password"
              aria-invalid={error === "keyRefused" || undefined}
              placeholder={provider.key ? "Saved, paste to change" : "Optional"}
              value={key}
              onChange={(e) => {
                setKey(e.target.value);
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
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
          {error && !addressError ? (
            <div className="pl-18">
              <ErrorLine>
                {error === "keyRefused"
                  ? "This server didn't accept the key"
                  : errorText(error, "this address")}
              </ErrorLine>
            </div>
          ) : null}
          {keyringAvailable || !key ? null : (
            <div className="pl-18">
              <RememberChoice remember={remember} onChange={setRemember} />
            </div>
          )}
        </form>
      </ProviderRow>
    );
  }

  if (provider.custom) {
    const storage = storageLine(provider.key);
    const failed = models?.state === "failed";
    return (
      <ProviderRow
        name={provider.name}
        description={
          <>
            <div>
              <Saved>
                {hostOf(provider.custom.address)}
                <Dot />
                {provider.key ? "Key saved" : "No key"}
                <Dot />
                <span className={cn(failed && "text-destructive")}>
                  {modelCount(
                    models,
                    failed ? errorText(models.error, "this address") : "",
                  )}
                </span>
              </Saved>
            </div>
            {storage ? <div>{storage}</div> : null}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={open}>
              Edit
            </Button>
            <Button variant="outline" size="sm" onClick={onRemove}>
              Remove
            </Button>
          </>
        }
      />
    );
  }

  return (
    <ProviderRow
      name={provider.name}
      description="Any server with an OpenAI, Anthropic or Google style API"
      actions={
        <Button variant="outline" size="sm" onClick={open}>
          Set up
        </Button>
      }
    />
  );
}
