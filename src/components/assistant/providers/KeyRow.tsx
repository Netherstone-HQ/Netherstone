import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRightIcon } from "lucide-react";

import { type Models, errorKind } from "@/components/assistant/models";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { Input } from "@/components/ui/input";
import {
  type AssistantModel,
  type AssistantProvider,
  type ProviderError,
  saveAssistantKey,
} from "@/lib/commands/assistant";
import {
  ErrorLine,
  ProviderRow,
  RememberChoice,
  Saved,
  Spinner,
  errorText,
  modelCount,
  storageLine,
} from "./ProviderRow";
import { showError } from "./useProviderSetup";

export function KeyRow({
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
