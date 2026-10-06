import { useEffect, useState } from "react";
import { CheckCircleIcon, CircleNotchIcon } from "@phosphor-icons/react";

import { GitHubAvatar } from "@/components/settings/GitHubAccountSection";
import { GitHubAppInstallNotice } from "@/components/settings/GitHubAppInstallNotice";
import { GitHubSignIn } from "@/components/settings/GitHubSignIn";
import { Button } from "@/components/ui/button";
import { useGitHubStore } from "@/store/github";
import { useSyncStore } from "@/store/sync";
import { copy } from "./copy";
import { Hint, Step } from "./StepLayout";

export function SyncStep({
  vaultPath,
  onBack,
  onNext,
}: {
  vaultPath: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const account = useGitHubStore((s) => s.account);
  const accountLoaded = useGitHubStore((s) => s.loaded);
  const loadAccount = useGitHubStore((s) => s.load);
  const signInError = useGitHubStore((s) => s.error);
  const installed = useGitHubStore((s) => s.installation?.installed ?? false);
  const syncEnabled = useSyncStore(
    (s) => s.vaultPath === vaultPath && (s.record?.syncEnabled ?? false),
  );
  // The vault's record can still say on after GitHub was disconnected, or
  // when it was set up on an earlier install. It only syncs once connected.
  const syncOn = syncEnabled && account !== null;
  const isWorking = useSyncStore((s) => s.vaultPath === vaultPath && s.isWorking);
  const syncError = useSyncStore((s) => (s.vaultPath === vaultPath ? s.error : null));
  const turnOn = useSyncStore((s) => s.turnOn);
  // A restored vault, or one that was already open, may sync already.
  const [wasOnAlready] = useState(syncEnabled);

  useEffect(() => {
    if (!accountLoaded) void loadAccount();
  }, [accountLoaded, loadAccount]);

  let body: React.ReactNode;
  if (!accountLoaded) {
    body = <div className="h-9" />;
  } else if (syncOn) {
    body = (
      <p className="onboarding-fade flex items-center gap-3 rounded-xl border bg-card p-4 text-sm">
        <CheckCircleIcon weight="fill" className="size-5" />
        {wasOnAlready ? copy.sync.alreadyOn : copy.sync.done}
      </p>
    );
  } else if (!account) {
    body = <GitHubSignIn />;
  } else {
    body = (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border bg-card p-4">
          <GitHubAvatar account={account} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-sm">
              {account.name ?? account.login}
            </div>
            <div className="truncate text-muted-foreground text-sm">
              @{account.login}
            </div>
          </div>
          {installed ? (
            <Button onClick={() => void turnOn(vaultPath)} disabled={isWorking}>
              {isWorking ? <CircleNotchIcon className="animate-spin" /> : null}
              {isWorking ? copy.sync.working : copy.sync.turnOn}
            </Button>
          ) : null}
        </div>
        <GitHubAppInstallNotice />
      </div>
    );
  }

  const error = signInError ?? syncError;

  return (
    <Step
      title={copy.sync.title}
      body={copy.sync.body}
      onBack={onBack}
      action={
        syncOn ? (
          <Button onClick={onNext}>{copy.common.continue}</Button>
        ) : (
          <Button variant="outline" onClick={onNext} disabled={isWorking}>
            {copy.common.skip}
          </Button>
        )
      }
    >
      <div className="mb-8 -mt-4 space-y-3 text-muted-foreground text-sm leading-6">
        {copy.sync.explainer.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
      <div className="space-y-4">
        {body}
        {error ? <Hint tone="error">{error}</Hint> : null}
        {syncOn ? null : <Hint>{copy.sync.later}</Hint>}
      </div>
    </Step>
  );
}
