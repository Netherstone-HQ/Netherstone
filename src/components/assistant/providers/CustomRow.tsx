import { useId, useState } from "react";

import { type Models, errorKind } from "@/components/assistant/models";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AssistantApi,
  type AssistantModel,
  type AssistantProvider,
  type ProviderError,
  saveCustomProvider,
} from "@/lib/commands/assistant";
import { cn } from "@/lib/utils";
import {
  ErrorLine,
  ProviderRow,
  RememberChoice,
  Saved,
  Spinner,
  errorText,
  hostOf,
  modelCount,
  storageLine,
} from "./ProviderRow";

const API_OPTIONS: { value: AssistantApi; label: string }[] = [
  { value: "openAi", label: "OpenAI-style" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
];

export function CustomRow({
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
