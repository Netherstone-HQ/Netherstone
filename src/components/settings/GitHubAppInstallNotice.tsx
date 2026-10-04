import { useEffect } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { useGitHubStore } from "@/store/github";

/** How often to look for the installation while the user is installing. */
const RECHECK_INTERVAL_MS = 4000;

/**
 * Asks the user to install the Netherstone GitHub App on their account when
 * it isn't yet, and notices the install on its own once it happens.
 */
export function GitHubAppInstallNotice() {
  const login = useGitHubStore((s) => s.account?.login);
  const installation = useGitHubStore((s) => s.installation);
  const error = useGitHubStore((s) => s.installationError);
  const checkInstallation = useGitHubStore((s) => s.checkInstallation);

  useEffect(() => {
    void checkInstallation();
  }, [checkInstallation]);

  const installed = installation?.installed ?? false;
  useEffect(() => {
    if (installed) return;
    const onFocus = () => void checkInstallation();
    const timer = window.setInterval(onFocus, RECHECK_INTERVAL_MS);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkInstallation, installed]);

  if (error) {
    return <p className="text-destructive text-xs leading-5">{error}</p>;
  }
  if (!installation || installation.installed) return null;

  const elsewhere = installation.installedOn;

  return (
    <div className="space-y-2.5 rounded-lg border bg-background p-3">
      <p className="font-medium text-sm">One more step on GitHub</p>
      <p className="text-muted-foreground text-xs leading-5">
        {elsewhere.length > 0
          ? `Netherstone is installed on ${elsewhere.join(", ")}, but backups go to your personal account. Install it on ${login ? `@${login}` : "your account"} too.`
          : "Install the Netherstone app so it can create your backup repository and keep it up to date."}{" "}
        When GitHub asks, choose{" "}
        <span className="text-foreground">All repositories</span>. Netherstone
        only touches the repositories it creates.
      </p>
      <Button size="sm" onClick={() => void openUrl(installation.installUrl)}>
        Install on GitHub
      </Button>
      <p className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
        <CircleNotchIcon className="size-3.5 animate-spin" />
        Continues on its own once it's installed
      </p>
    </div>
  );
}
