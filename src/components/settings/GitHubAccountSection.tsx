import { useEffect } from "react";

import { GitHubAppInstallNotice } from "@/components/settings/GitHubAppInstallNotice";
import { GitHubSignIn } from "@/components/settings/GitHubSignIn";
import { SettingsGroup } from "@/components/settings/settings-ui";
import { SyncHelpDialog } from "@/components/settings/SyncHelpDialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { GitHubAccount, GitHubTokenStorage } from "@/lib/github-account";
import { useGitHubStore } from "@/store/github";

export function GitHubAccountSection() {
  const account = useGitHubStore((s) => s.account);
  const loaded = useGitHubStore((s) => s.loaded);
  const error = useGitHubStore((s) => s.error);
  const load = useGitHubStore((s) => s.load);
  const signOut = useGitHubStore((s) => s.signOut);
  const storage = useGitHubStore((s) => s.tokenStorage?.current ?? null);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SettingsGroup
      title="GitHub account"
      description={
        <span className="inline-flex items-center gap-1.5">
          Your vaults sync through your GitHub account
          <SyncHelpDialog />
        </span>
      }
    >
      <div className="p-4">
        {!loaded ? (
          <div className="h-9" />
        ) : account ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <GitHubAvatar account={account} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-ui">
                  {account.name ?? account.login}
                </div>
                <div className="truncate text-muted-foreground text-ui-sm">
                  @{account.login}
                </div>
              </div>
              <Button variant="outline" onClick={() => void signOut()}>
                Disconnect
              </Button>
            </div>
            <TokenStorageNote storage={storage} />
            <GitHubAppInstallNotice />
          </div>
        ) : (
          <GitHubSignIn />
        )}

        {error ? (
          <p className="mt-3 text-destructive text-ui">{error}</p>
        ) : null}
      </div>
    </SettingsGroup>
  );
}

/** Says where the sign-in is kept, when it isn't in a keyring. */
function TokenStorageNote({ storage }: { storage: GitHubTokenStorage | null }) {
  if (storage === "file") {
    return (
      <p className="text-muted-foreground text-ui-sm leading-5">
        Saved in a file only you can read, install GNOME Keyring or KWallet
        and restart to use a keyring
      </p>
    );
  }
  if (storage === "memory") {
    return (
      <p className="text-muted-foreground text-ui-sm leading-5">
        You'll connect again next time you open Netherstone
      </p>
    );
  }
  return null;
}

export function GitHubAvatar({
  account,
  size = "lg",
}: {
  account: GitHubAccount;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <Avatar size={size}>
      {account.avatarUrl ? (
        <AvatarImage src={account.avatarUrl} alt="" />
      ) : null}
      <AvatarFallback>{account.login.slice(0, 1).toUpperCase()}</AvatarFallback>
    </Avatar>
  );
}
