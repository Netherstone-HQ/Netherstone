import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { FreeUpSpaceRow } from "@/components/settings/FreeUpSpaceRow";
import {
  GoneVaultsRow,
  useGoneVaultHistories,
} from "@/components/settings/GoneVaultsRow";
import {
  PreferenceSegments,
  SettingRow,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openVaultDialog, type RenameVaultError } from "@/lib/commands/vault";
import { leaveSettings } from "@/lib/leave-settings";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { openVault } from "@/lib/open-vault";
import { IS_MOBILE, REVEAL_LABEL } from "@/lib/platform";
import { indexVault } from "@/lib/refresh-vault";
import { renameVault } from "@/lib/rename-vault";
import { errorText } from "@/lib/utils";
import { useVaultStore } from "@/store/vault";

export function VaultSettings() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const [goneHistories, setGoneHistories] = useGoneVaultHistories();
  const hasGoneHistories = (goneHistories?.length ?? 0) > 0;

  return (
    <>
      <SettingsGroup title="Location">
        {vaultPath ? (
          <VaultNameRow vaultPath={vaultPath} />
        ) : (
          <SettingRow
            label="No vault open"
            description="Any folder works, even an empty one"
          />
        )}
        {/* Phones switch vaults from the vault menu, and have no folder picker. */}
        {IS_MOBILE ? null : (
          <SettingRow
            label="Open another vault"
            description="Switch to a different folder"
          >
            <Button variant="outline" size="sm" onClick={() => void openOther()}>
              Choose folder
            </Button>
          </SettingRow>
        )}
      </SettingsGroup>

      {/* On phones a new shard goes in the folder on screen. */}
      {IS_MOBILE ? null : (
        <SettingsGroup title="New shards">
          <PreferenceSegments
            name="newShardLocation"
            label="Create new shards in"
            description="Where a shard goes when you create it from the sidebar or header"
            options={[
              { value: "vault-root", label: "Top of the vault" },
              { value: "current-folder", label: "Current folder" },
            ]}
          />
        </SettingsGroup>
      )}

      {vaultPath ? (
        <SettingsGroup title="Search">
          <RefreshIndexRow vaultPath={vaultPath} />
        </SettingsGroup>
      ) : null}

      {vaultPath || hasGoneHistories ? (
        <SettingsGroup title="History">
          {vaultPath ? <FreeUpSpaceRow vaultPath={vaultPath} /> : null}
          {goneHistories && hasGoneHistories ? (
            <GoneVaultsRow
              histories={goneHistories}
              onChange={setGoneHistories}
            />
          ) : null}
        </SettingsGroup>
      ) : null}
    </>
  );
}

const RENAME_ERRORS = {
  "vault-name-empty": "Give your vault a name.",
  "vault-name-invalid":
    'A vault name can\'t contain / \\ : * ? " < > | or end with a dot.',
  "vault-name-taken": "There's already a folder with that name next to this vault.",
  "vault-in-use":
    "Another app has a file from this vault open. Close it, then try again.",
} satisfies Record<RenameVaultError, string>;

function renameErrorText(error: unknown) {
  const code = errorText(error);
  return code in RENAME_ERRORS
    ? RENAME_ERRORS[code as RenameVaultError]
    : code;
}

/** The vault's name and folder, renamed in place. */
function VaultNameRow({ vaultPath }: { vaultPath: string }) {
  const name = vaultName(vaultPath);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function cancel() {
    setDraft(null);
    setError(null);
  }

  if (draft === null) {
    return (
      <SettingRow
        label={name}
        description={<span className="break-all font-mono">{vaultPath}</span>}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setDraft(name)}>
            Rename
          </Button>
          {IS_MOBILE ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void revealItemInDir(vaultPath).catch(showError)}
            >
              {REVEAL_LABEL}
            </Button>
          )}
        </div>
      </SettingRow>
    );
  }

  const canSave = draft.trim().length > 0 && draft.trim() !== name && !saving;
  return (
    <form
      className="flex flex-col gap-2 border-b last:border-b-0 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        setSaving(true);
        setError(null);
        renameVault(draft)
          .then(cancel)
          .catch((error: unknown) => setError(renameErrorText(error)))
          .finally(() => setSaving(false));
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          aria-label="Vault name"
          value={draft}
          disabled={saving}
          aria-invalid={error ? true : undefined}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            }
          }}
          className="h-9 flex-1"
        />
        <Button type="submit" size="sm" disabled={!canSave}>
          {saving ? <LoaderCircleIcon className="animate-spin" /> : null}
          {saving ? "Renaming" : "Rename"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={saving}
          onClick={cancel}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-ui-sm">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function RefreshIndexRow({ vaultPath }: { vaultPath: string }) {
  const [working, setWorking] = useState(false);

  async function refresh() {
    setWorking(true);
    try {
      await indexVault(vaultPath);
      toast("Search index is up to date.");
    } catch (error) {
      showError(error);
    } finally {
      setWorking(false);
    }
  }

  return (
    <SettingRow
      label="Refresh search index"
      description="Use it when search, tags or links look out of date"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={working}
        onClick={() => void refresh()}
      >
        {working ? <LoaderCircleIcon className="animate-spin" /> : null}
        {working ? "Refreshing" : "Refresh"}
      </Button>
    </SettingRow>
  );
}

async function openOther() {
  const picked = await openVaultDialog();
  const path = picked && (await chooseVaultFolder(picked, "open"));
  if (!path) return;
  try {
    await openVault(path);
    leaveSettings();
  } catch (error) {
    showError(error);
  }
}

function vaultName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || path
  );
}

function showError(error: unknown) {
  toast.error(errorText(error));
}
