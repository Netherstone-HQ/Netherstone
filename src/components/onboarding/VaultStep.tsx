import { useEffect, useState } from "react";
import {
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  LoaderCircleIcon,
  RotateCcwIcon,
} from "lucide-react";
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
import { chooseVaultFolder } from "@/lib/nested-vault";
import { folderName, joinPath, openVault } from "@/lib/open-vault";
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
    const picked = await openVaultDialog();
    const path = picked && (await chooseVaultFolder(picked, "open"));
    if (!path) return;
    await openVault(path);
    onChoose({ path, kind: "opened" });
  }

  return (
    <Step title={copy.vault.title} body={copy.vault.body} onBack={onBack}>
      <div className="space-y-2.5">
        {currentVaultPath ? (
          <ChoiceCard
            icon={<FolderIcon />}
            title={copy.vault.keep.title(folderName(currentVaultPath))}
            description={copy.vault.keep.description}
            onClick={() => onChoose({ path: currentVaultPath, kind: "kept" })}
          />
        ) : null}

        <ChoiceCard
          icon={<FolderPlusIcon />}
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
          icon={<RotateCcwIcon />}
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
  disabled,
}: {
  label: string;
  location: string | null;
  onChange: (location: string) => void;
  disabled?: boolean;
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
          className="flex h-9 min-w-0 flex-1 items-center truncate rounded-md border bg-background px-2.5 text-muted-foreground text-ui dark:bg-input/30"
          title={location ?? undefined}
        >
          {location ?? copy.vault.create.chooseLocation}
        </span>
        {disabled ? null : (
          <Button type="button" variant="outline" onClick={() => void change()}>
            {location ? copy.vault.create.change : copy.vault.create.choose}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Makes an empty vault with the Start here guide. */
async function createEmptyVault(location: string, name: string): Promise<VaultChoice> {
  const path = await createVault(location, name);
  await openVault(path);
  const startHerePath = await addStartHere(path);
  return { path, kind: "created", startHerePath };
}

export function CreateVaultForm({
  location,
  onLocationChange,
  onCreated,
  defaultName = copy.vault.create.defaultName,
  create: createIn = createEmptyVault,
  busyLabel,
}: {
  location: string | null;
  onLocationChange: (location: string) => void;
  onCreated: (choice: VaultChoice) => void;
  defaultName?: string;
  /**
   * Makes the vault `location/name` and opens it: an empty one by default.
   * Null when it didn't, having said why itself.
   */
  create?: (location: string, name: string) => Promise<VaultChoice | null>;
  /** Shown on the button while `create` runs, with the fields locked. */
  busyLabel?: string;
}) {
  const [name, setName] = useState<string>(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!location) return;
    setBusy(true);
    setError(null);
    try {
      const target = joinPath(location, name.trim());
      const chosen = await chooseVaultFolder(target, "create");
      if (chosen !== target) {
        if (chosen) {
          await openVault(chosen);
          onCreated({ path: chosen, kind: "opened" });
        } else {
          setBusy(false);
        }
        return;
      }
      const created = await createIn(location, name);
      if (created) onCreated(created);
      else setBusy(false);
    } catch (e) {
      setError(vaultErrorText(e));
      setBusy(false);
    }
  }

  const locked = busy && !!busyLabel;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <label className={cn("block space-y-1.5", locked && "opacity-50")}>
        <FieldLabel>{copy.vault.create.nameLabel}</FieldLabel>
        <Input
          value={name}
          disabled={locked}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
          autoFocus
        />
      </label>
      <div className={cn(locked && "opacity-50")}>
        <LocationRow
          label={copy.vault.create.locationLabel}
          location={location}
          disabled={locked}
          onChange={(next) => {
            onLocationChange(next);
            setError(null);
          }}
        />
      </div>
      {error ? <Hint tone="error">{error}</Hint> : null}
      <Button type="submit" disabled={busy || !location}>
        {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
        {locked ? busyLabel : copy.vault.create.submit}
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
  // The lookup failed when it came back empty with an error.
  const listError = useSyncStore((s) =>
    s.backups?.length === 0 ? s.error : null,
  );
  const [chosen, setChosen] = useState<BackupSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The folder a failed restore already created, so trying again fills it
  // in place of making a second one.
  const [restorePath, setRestorePath] = useState<string | null>(null);

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
    let path = restorePath;
    try {
      if (!path) {
        const target = joinPath(location, backup.name);
        const picked = await chooseVaultFolder(target, "create");
        if (picked !== target) {
          if (picked) {
            await openVault(picked);
            onRestored({ path: picked, kind: "opened" });
          } else {
            setBusy(false);
          }
          return;
        }
      }
      path ??= await createVault(location, backup.name);
      setRestorePath(path);
      await openVault(path);
      const sync = useSyncStore.getState();
      await sync.load(path);
      await sync.connect(path, backup);
      const after = useSyncStore.getState();
      if (after.error || !after.record?.syncEnabled) {
        setError(after.error ?? copy.vault.restore.failed);
        setBusy(false);
        return;
      }
      onRestored({ path, kind: "restored" });
    } catch (e) {
      // Once the folder exists, what failed is the download.
      setError(path ? copy.vault.restore.failed : vaultErrorText(e));
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
      <p className="inline-flex items-center gap-2 text-muted-foreground text-ui">
        <LoaderCircleIcon className="size-4 animate-spin" />
        {copy.vault.restore.loading}
      </p>
    );
  }

  if (listError) {
    return (
      <div className="space-y-3">
        <Hint tone="error">{listError}</Hint>
        <Button variant="outline" onClick={() => void loadBackups()}>
          {copy.vault.restore.retry}
        </Button>
      </div>
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
            onClick={() => {
              setChosen(backup);
              setRestorePath(null);
              setError(null);
            }}
            disabled={busy}
            className={cn(
              "flex h-10 w-full items-center justify-between gap-3 rounded-md border bg-background px-3 text-left text-ui transition-colors hover:border-foreground/20 dark:bg-input/30",
              chosen?.fullName === backup.fullName && "border-foreground/40",
            )}
          >
            <span className="truncate font-medium">{backup.name}</span>
            <span className="shrink-0 text-muted-foreground text-ui-sm">
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
            onChange={(next) => {
              onLocationChange(next);
              setRestorePath(null);
              setError(null);
            }}
          />
          {error ? <Hint tone="error">{error}</Hint> : null}
          <Button onClick={() => void restore(chosen)} disabled={busy || !location}>
            {busy ? <LoaderCircleIcon className="animate-spin" /> : null}
            {busy ? copy.vault.restore.working : copy.vault.restore.submit}
          </Button>
        </>
      ) : null}
    </div>
  );
}
