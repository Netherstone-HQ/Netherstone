import { useEffect, useState } from "react";
import {
  ArrowCounterClockwiseIcon,
  CircleNotchIcon,
  FolderOpenIcon,
  FolderSimpleIcon,
  FolderSimplePlusIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNow } from "date-fns";

import { GitHubAppInstallNotice } from "@/components/settings/GitHubAppInstallNotice";
import { GitHubSignIn } from "@/components/settings/GitHubSignIn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  createVault,
  defaultVaultLocation,
  openVaultDialog,
} from "@/lib/commands";
import { errorMessage } from "@/lib/github-account";
import { folderName, openVault } from "@/lib/open-vault";
import type { BackupSummary } from "@/lib/sync";
import { cn } from "@/lib/utils";
import { useVaultStore } from "@/store";
import { useGitHubStore } from "@/store/github";
import { useSyncStore } from "@/store/sync";
import { copy } from "./copy";
import { addStartHere } from "./start-here";
import { ChoiceCard, FieldLabel, Hint, Step } from "./StepLayout";

export type VaultChoice = {
  path: string;
  kind: "kept" | "created" | "opened" | "restored";
  /** The guide written into a new vault, opened when onboarding ends. */
  startHerePath?: string;
};

type Option = "create" | "restore";

/** Turns a failure from `create_vault` into a sentence from copy.ts. */
function vaultErrorText(error: unknown) {
  const code = errorMessage(error);
  const errors: Record<string, string> = copy.vault.errors;
  if (code in errors) return errors[code];
  console.error("[Netherstone] Couldn't set up the vault:", error);
  return copy.vault.errors.unknown;
}

export function VaultStep({
  onBack,
  onChoose,
}: {
  onBack: () => void;
  onChoose: (choice: VaultChoice) => void;
}) {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const [option, setOption] = useState<Option | null>(null);
  const [location, setLocation] = useState<string | null>(null);

  useEffect(() => {
    void defaultVaultLocation()
      .then(setLocation)
      .catch(() => {});
  }, []);

  async function openExisting() {
    const path = await openVaultDialog();
    if (!path) return;
    await openVault(path);
    onChoose({ path, kind: "opened" });
  }

  return (
    <Step title={copy.vault.title} body={copy.vault.body} onBack={onBack}>
      <div className="space-y-2.5">
        {currentVaultPath ? (
          <ChoiceCard
            icon={<FolderSimpleIcon />}
            title={copy.vault.keep.title(folderName(currentVaultPath))}
            description={copy.vault.keep.description}
            onClick={() => onChoose({ path: currentVaultPath, kind: "kept" })}
          />
        ) : null}

        <ChoiceCard
          icon={<FolderSimplePlusIcon />}
          title={copy.vault.create.title}
          description={copy.vault.create.description}
          selected={option === "create"}
          onClick={() => setOption(option === "create" ? null : "create")}
        >
          <CreateVaultForm
            location={location}
            onLocationChange={setLocation}
            onCreated={onChoose}
          />
        </ChoiceCard>

        <ChoiceCard
          icon={<FolderOpenIcon />}
          title={copy.vault.open.title}
          description={copy.vault.open.description}
          onClick={() => {
            setOption(null);
            void openExisting();
          }}
        />

        <ChoiceCard
          icon={<ArrowCounterClockwiseIcon />}
          title={copy.vault.restore.title}
          description={copy.vault.restore.description}
          selected={option === "restore"}
          onClick={() => setOption(option === "restore" ? null : "restore")}
        >
          <RestoreVault
            location={location}
            onLocationChange={setLocation}
            onRestored={onChoose}
          />
        </ChoiceCard>
      </div>
    </Step>
  );
}

function LocationRow({
  label,
  location,
  onChange,
}: {
  label: string;
  location: string | null;
  onChange: (location: string) => void;
}) {
  async function change() {
    const path = await openVaultDialog();
    if (path) onChange(path);
  }

  return (
    <div className="space-y-1.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <span
          className="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border bg-background px-2.5 text-muted-foreground text-sm dark:bg-input/30"
          title={location ?? undefined}
        >
          {location ?? "…"}
        </span>
        <Button type="button" variant="outline" onClick={() => void change()}>
          {copy.vault.create.change}
        </Button>
      </div>
    </div>
  );
}

function CreateVaultForm({
  location,
  onLocationChange,
  onCreated,
}: {
  location: string | null;
  onLocationChange: (location: string) => void;
  onCreated: (choice: VaultChoice) => void;
}) {
  const [name, setName] = useState<string>(copy.vault.create.defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!location) return;
    setBusy(true);
    setError(null);
    try {
      const path = await createVault(location, name);
      const startHerePath = await addStartHere(path);
      await openVault(path);
      onCreated({ path, kind: "created", startHerePath });
    } catch (e) {
      setError(vaultErrorText(e));
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label className="block space-y-1.5">
        <FieldLabel>{copy.vault.create.nameLabel}</FieldLabel>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={error ? true : undefined}
          autoFocus
        />
      </label>
      <LocationRow
        label={copy.vault.create.locationLabel}
        location={location}
        onChange={onLocationChange}
      />
      {error ? <Hint tone="error">{error}</Hint> : null}
      <Button type="submit" disabled={busy || !location}>
        {busy ? <CircleNotchIcon className="animate-spin" /> : null}
        {copy.vault.create.submit}
      </Button>
    </form>
  );
}

function RestoreVault({
  location,
  onLocationChange,
  onRestored,
}: {
  location: string | null;
  onLocationChange: (location: string) => void;
  onRestored: (choice: VaultChoice) => void;
}) {
  const account = useGitHubStore((s) => s.account);
  const accountLoaded = useGitHubStore((s) => s.loaded);
  const loadAccount = useGitHubStore((s) => s.load);
  const signInError = useGitHubStore((s) => s.error);
  const installed = useGitHubStore((s) => s.installation?.installed ?? false);
  const backups = useSyncStore((s) => s.backups);
  const loadBackups = useSyncStore((s) => s.loadBackups);
  const [chosen, setChosen] = useState<BackupSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountLoaded) void loadAccount();
  }, [accountLoaded, loadAccount]);

  useEffect(() => {
    if (account && installed) void loadBackups();
  }, [account, installed, loadBackups]);

  async function restore(backup: BackupSummary) {
    if (!location) return;
    setBusy(true);
    setError(null);
    try {
      const path = await createVault(location, backup.name);
      await openVault(path);
      const sync = useSyncStore.getState();
      await sync.load(path);
      await sync.connect(path, backup);
      const after = useSyncStore.getState();
      if (after.error || !after.record?.syncEnabled) {
        setError(after.error ?? copy.vault.errors.unknown);
        setBusy(false);
        return;
      }
      onRestored({ path, kind: "restored" });
    } catch (e) {
      setError(vaultErrorText(e));
      setBusy(false);
    }
  }

  if (!accountLoaded) return null;

  if (!account) {
    return (
      <div className="space-y-4">
        <Hint>{copy.vault.restore.signInFirst}</Hint>
        <GitHubSignIn />
        {signInError ? <Hint tone="error">{signInError}</Hint> : null}
      </div>
    );
  }

  if (!installed) return <GitHubAppInstallNotice />;

  if (backups === null) {
    return (
      <p className="inline-flex items-center gap-2 text-muted-foreground text-sm">
        <CircleNotchIcon className="size-4 animate-spin" />
        {copy.vault.restore.loading}
      </p>
    );
  }

  if (backups.length === 0) {
    return <Hint>{copy.vault.restore.empty}</Hint>;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5" role="radiogroup">
        {backups.map((backup) => (
          <button
            key={backup.fullName}
            type="button"
            role="radio"
            aria-checked={chosen?.fullName === backup.fullName}
            onClick={() => setChosen(backup)}
            disabled={busy}
            className={cn(
              "flex h-10 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-sm transition-colors hover:border-foreground/20 dark:bg-input/30",
              chosen?.fullName === backup.fullName && "border-foreground/40",
            )}
          >
            <span className="truncate font-medium">{backup.name}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {backup.pushedAt
                ? copy.vault.restore.lastSynced(
                    formatDistanceToNow(new Date(backup.pushedAt), { addSuffix: true }),
                  )
                : copy.vault.restore.neverSynced}
            </span>
          </button>
        ))}
      </div>

      {chosen ? (
        <>
          <LocationRow
            label={copy.vault.restore.locationLabel}
            location={location}
            onChange={onLocationChange}
          />
          {error ? <Hint tone="error">{error}</Hint> : null}
          <Button onClick={() => void restore(chosen)} disabled={busy || !location}>
            {busy ? <CircleNotchIcon className="animate-spin" /> : null}
            {busy ? copy.vault.restore.working : copy.vault.restore.submit}
          </Button>
        </>
      ) : null}
    </div>
  );
}
