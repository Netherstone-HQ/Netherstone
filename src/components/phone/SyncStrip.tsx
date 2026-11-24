import { AlertCircleIcon, CloudOffIcon } from "lucide-react";
import { useGitHubStore } from "@/store/github";
import { useSyncStore } from "@/store/sync";
import { usePhoneNav } from "./nav";

/** What's wrong with sync for the open vault, if anything. */
export type SyncProblem = "offline" | "error" | "conflict";

export function useSyncProblem(vaultPath: string | null): SyncProblem | null {
  return useSyncStore((s) => {
    if (!vaultPath || s.vaultPath !== vaultPath || !s.record?.syncEnabled)
      return null;
    if (s.record.conflicts.length > 0) return "conflict";
    if (s.error) return "error";
    return s.offline ? "offline" : null;
  });
}

/** Sync's state in a word or two, for the vault menu and Settings. */
export function syncStatusLabel(syncOn: boolean, problem: SyncProblem | null) {
  if (!syncOn) return "Off";
  if (problem === "offline") return "Offline";
  return problem ? "Needs attention" : "Up to date";
}

const STRIP_CLASS =
  "mx-4 mb-2 flex min-h-14 shrink-0 items-center gap-3 rounded-xl border bg-card py-1 pr-1 pl-4";
const ACTION_CLASS =
  "flex h-11 shrink-0 items-center rounded-lg px-3 font-medium text-brand outline-none active:bg-accent";

/** A line over the search field saying sync needs something, with the fix. */
export function SyncStrip({
  vaultPath,
  problem,
}: {
  vaultPath: string;
  problem: SyncProblem;
}) {
  const conflicts = useSyncStore((s) => s.record?.conflicts ?? []);
  const showConflict = useSyncStore((s) => s.showConflict);
  const sync = useSyncStore((s) => s.sync);
  const signedIn = useGitHubStore((s) => s.account !== null);
  const push = usePhoneNav((s) => s.push);

  if (problem === "offline") {
    return (
      <div role="status" className={STRIP_CLASS}>
        <CloudOffIcon className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          Offline. Changes will sync later.
        </span>
      </div>
    );
  }

  if (problem === "conflict") {
    const count = conflicts.length;
    return (
      <div role="status" className={STRIP_CLASS}>
        <AlertCircleIcon className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="min-w-0 flex-1">
          {count === 1
            ? "1 shard needs a decision"
            : `${count} shards need a decision`}
        </span>
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={() => showConflict(conflicts[0] ?? null)}
        >
          Choose
        </button>
      </div>
    );
  }

  return (
    <div role="status" className={STRIP_CLASS}>
      <AlertCircleIcon className="size-5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1">Sync stopped</span>
      {signedIn ? (
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={() => void sync(vaultPath)}
        >
          Try again
        </button>
      ) : (
        <button
          type="button"
          className={ACTION_CLASS}
          onClick={() => push({ kind: "settings", category: "sync" })}
        >
          Sign in to GitHub
        </button>
      )}
    </div>
  );
}
