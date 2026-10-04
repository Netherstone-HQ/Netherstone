import { useEffect, useState } from "react";
import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  CloudSlashIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { formatDistanceToNow } from "date-fns";

import { GitHubAvatar } from "@/components/settings/GitHubAccountSection";
import { GitHubAppInstallNotice } from "@/components/settings/GitHubAppInstallNotice";
import { GitHubSignIn } from "@/components/settings/GitHubSignIn";
import { Button } from "@/components/ui/button";
import {
  type BackupSummary,
  describeBackupContents,
  describeSkipReason,
  fileName,
  formatBytes,
  type SyncConflict,
  type SyncPlanSummary,
  type VaultSyncRecord,
} from "@/lib/sync";
import { cn } from "@/lib/utils";
import { useGitHubStore } from "@/store/github";
import { useSyncStore } from "@/store/sync";

/** Sync status and controls for the open vault (sidebar popover, Settings). */
export function BackupPanel({
  vaultPath,
  showTitle = true,
}: {
  vaultPath: string;
  showTitle?: boolean;
}) {
  const account = useGitHubStore((s) => s.account);
  const accountLoaded = useGitHubStore((s) => s.loaded);
  const accountError = useGitHubStore((s) => s.error);
  const loadAccount = useGitHubStore((s) => s.load);
  const appInstalled = useGitHubStore((s) => s.installation?.installed ?? false);

  const record = useSyncStore((s) => s.record);
  const recordLoaded = useSyncStore((s) => s.loaded && s.vaultPath === vaultPath);
  const plan = useSyncStore((s) => s.plan);
  const isWorking = useSyncStore((s) => s.isWorking);
  const error = useSyncStore((s) => s.error);
  const load = useSyncStore((s) => s.load);
  const loadPlan = useSyncStore((s) => s.loadPlan);
  const turnOn = useSyncStore((s) => s.turnOn);
  const sync = useSyncStore((s) => s.sync);
  const turnOff = useSyncStore((s) => s.turnOff);
  const offline = useSyncStore((s) => s.offline);
  const [restoring, setRestoring] = useState(false);
  const showConflict = useSyncStore((s) => s.showConflict);

  useEffect(() => {
    if (!accountLoaded) void loadAccount();
  }, [accountLoaded, loadAccount]);

  useEffect(() => {
    void load(vaultPath);
  }, [load, vaultPath]);

  const enabled = record?.syncEnabled ?? false;
  useEffect(() => {
    // Refreshed on every open, since the vault may have changed since.
    if (recordLoaded && !enabled) void loadPlan(vaultPath);
  }, [enabled, loadPlan, recordLoaded, vaultPath]);

  let body: React.ReactNode;
  if (!accountLoaded || !recordLoaded) {
    body = <div className="h-16" />;
  } else if (!account) {
    body = (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm">
          Connect GitHub to back up this vault to a private repository and
          sync it between your devices.
        </p>
        <GitHubSignIn compact />
        {accountError ? (
          <p className="text-destructive text-xs">{accountError}</p>
        ) : null}
      </div>
    );
  } else if (record?.syncEnabled) {
    const repoName = record.repoName;
    body = (
      <div className="space-y-3">
        <SyncStatus record={record} isWorking={isWorking} offline={offline} />
        {record.conflicts.length > 0 ? (
          <ConflictList conflicts={record.conflicts} onOpen={showConflict} />
        ) : null}
        {repoName ? (
          <button
            type="button"
            onClick={() => void openUrl(`https://github.com/${repoName}`)}
            className="flex w-full items-center gap-2 rounded-md border bg-background px-2.5 py-2 text-left text-xs transition-colors hover:bg-muted"
          >
            <GitHubAvatar account={account} size="sm" />
            <span className="min-w-0 flex-1 truncate">{repoName}</span>
            <ArrowSquareOutIcon className="size-3.5 text-muted-foreground" />
          </button>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isWorking}
            onClick={() => void sync(vaultPath)}
          >
            Sync now
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={isWorking}
            onClick={() => void turnOff(vaultPath)}
          >
            Turn off
          </Button>
        </div>
      </div>
    );
  } else if (restoring) {
    body = (
      <BackupPicker
        vaultPath={vaultPath}
        vaultHasFiles={(plan?.includedCount ?? 0) > 0}
        onBack={() => setRestoring(false)}
      />
    );
  } else {
    body = (
      <div className="space-y-3">
        {plan ? <BackupPreview plan={plan} login={account.login} /> : <div className="h-10" />}
        <GitHubAppInstallNotice />
        <Button
          className="w-full"
          disabled={isWorking || !plan || !appInstalled}
          onClick={() => void turnOn(vaultPath)}
        >
          {isWorking ? <CircleNotchIcon className="animate-spin" /> : null}
          {isWorking ? "Setting up" : "Turn on sync"}
        </Button>
        {appInstalled ? (
          <button
            type="button"
            disabled={isWorking}
            onClick={() => setRestoring(true)}
            className="w-full text-center text-muted-foreground text-xs hover:text-foreground disabled:pointer-events-none"
          >
            Already backed up on another device? Use that backup
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showTitle ? <h2 className="font-medium text-sm">Sync</h2> : null}
      {body}
      {error ? <p className="text-destructive text-xs leading-5">{error}</p> : null}
    </div>
  );
}

function BackupPreview({ plan, login }: { plan: SyncPlanSummary; login: string }) {
  const [showSkipped, setShowSkipped] = useState(false);
  const skipped = plan.skipped;

  return (
    <div className="space-y-2 text-sm">
      <p>
        {describeBackupContents(plan)}
        {plan.includedCount > 0 ? (
          <span className="text-muted-foreground"> ({formatBytes(plan.includedBytes)})</span>
        ) : null}{" "}
        will be backed up to a private repository on your GitHub account{" "}
        <span className="font-medium">@{login}</span> and kept in sync across
        your devices.
      </p>

      {skipped.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowSkipped((v) => !v)}
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
            aria-expanded={showSkipped}
          >
            <CaretRightIcon
              className={cn("size-3 transition-transform", showSkipped && "rotate-90")}
            />
            {skipped.length === 1
              ? "1 file stays on this device"
              : `${skipped.length} files stay on this device`}
          </button>
          {showSkipped ? (
            <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
              {skipped.map((file) => (
                <li key={file.path} className="text-xs">
                  <div className="truncate" title={file.path}>
                    {file.path.split("/").pop()}
                  </div>
                  <div className="text-muted-foreground">{describeSkipReason(file)}</div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SyncStatus({
  record,
  isWorking,
  offline,
}: {
  record: VaultSyncRecord;
  isWorking: boolean;
  offline: boolean;
}) {
  const since = record.lastSyncAt
    ? formatDistanceToNow(record.lastSyncAt * 1000, { addSuffix: true })
    : null;

  if (isWorking) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <CircleNotchIcon className="size-4 animate-spin text-muted-foreground" />
        Syncing
      </div>
    );
  }
  if (offline) {
    return (
      <div className="space-y-0.5">
        <div className="flex items-center gap-2 text-sm">
          <CloudSlashIcon className="size-4 text-muted-foreground" />
          Working offline
        </div>
        <p className="pl-6 text-muted-foreground text-xs">
          Changes sync when you're back online{since ? `. Last synced ${since}.` : "."}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm">
      <CheckCircleIcon weight="fill" className="size-4 text-emerald-500" />
      {since ? `Synced ${since}` : "Synced"}
    </div>
  );
}

function ConflictList({
  conflicts,
  onOpen,
}: {
  conflicts: SyncConflict[];
  onOpen: (conflict: SyncConflict) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5">
      <div className="flex items-center gap-2 text-sm">
        <WarningCircleIcon weight="fill" className="size-4 text-amber-500" />
        {conflicts.length === 1
          ? "1 file needs a decision"
          : `${conflicts.length} files need a decision`}
      </div>
      <ul className="max-h-32 space-y-1 overflow-y-auto">
        {conflicts.map((conflict) => (
          <li key={conflict.path} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate" title={conflict.path}>
              {fileName(conflict.path)}
            </span>
            <Button size="xs" variant="outline" onClick={() => onOpen(conflict)}>
              Choose
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function BackupPicker({
  vaultPath,
  vaultHasFiles,
  onBack,
}: {
  vaultPath: string;
  vaultHasFiles: boolean;
  onBack: () => void;
}) {
  const backups = useSyncStore((s) => s.backups);
  const loadBackups = useSyncStore((s) => s.loadBackups);
  const connect = useSyncStore((s) => s.connect);
  const isWorking = useSyncStore((s) => s.isWorking);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    void loadBackups();
  }, [loadBackups]);

  function use(backup: BackupSummary) {
    setChosen(backup.fullName);
    void connect(vaultPath, backup);
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {vaultHasFiles
          ? "Choose a backup to sync with this vault. Its files are added here, and this vault's files are added to it."
          : "Choose a backup to download into this vault. It stays in sync afterwards."}
      </p>
      {backups === null ? (
        <div className="flex h-16 items-center justify-center">
          <CircleNotchIcon className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : backups.length === 0 ? (
        <p className="text-sm">No backups found on your GitHub account.</p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {backups.map((backup) => (
            <li key={backup.fullName}>
              <button
                type="button"
                disabled={isWorking}
                onClick={() => use(backup)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
              >
                <span className="min-w-0 flex-1 truncate">{backup.name}</span>
                {isWorking && chosen === backup.fullName ? (
                  <CircleNotchIcon className="size-3.5 animate-spin text-muted-foreground" />
                ) : backup.pushedAt ? (
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {formatDistanceToNow(new Date(backup.pushedAt), { addSuffix: true })}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" disabled={isWorking} onClick={onBack}>
        Back
      </Button>
    </div>
  );
}
