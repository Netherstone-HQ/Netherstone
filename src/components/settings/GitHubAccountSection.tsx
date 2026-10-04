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
          Your vaults sync through private repositories on your own GitHub
          account.
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
                <div className="truncate font-medium text-sm">
                  {account.name ?? account.login}
                </div>
                <div className="truncate text-muted-foreground text-xs">
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
          <p className="mt-3 text-destructive text-sm">{error}</p>
        ) : null}
      </div>
    </SettingsGroup>
  );
}

/** Says where the sign-in is kept, when it isn't in a keyring. */
function TokenStorageNote({ storage }: { storage: GitHubTokenStorage | null }) {
  if (storage === "file") {
    return (
      <p className="text-muted-foreground text-xs leading-5">
        Your sign-in is saved in a file only your account can read, because this
        computer has no keyring. Install GNOME Keyring or KWallet and restart
        Netherstone to move it there.
      </p>
    );
  }
  if (storage === "memory") {
    return (
      <p className="text-muted-foreground text-xs leading-5">
        Your sign-in isn't saved on this computer. You'll connect again the next
        time you open Netherstone.
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
