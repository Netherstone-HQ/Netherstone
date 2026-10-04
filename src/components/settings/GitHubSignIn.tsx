import { useId, useState } from "react";
import {
  CheckIcon,
  CircleNotchIcon,
  CopyIcon,
  GithubLogoIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { GitHubSignInCode } from "@/lib/github-account";
import { cn } from "@/lib/utils";
import { useGitHubStore } from "@/store/github";

/**
 * "Connect GitHub" button, replaced by the device code prompt while a
 * sign-in waits for approval. Shared by Settings and the backup panel.
 */
export function GitHubSignIn({ compact = false }: { compact?: boolean }) {
  const signIn = useGitHubStore((s) => s.signIn);
  const startSignIn = useGitHubStore((s) => s.startSignIn);
  const cancelSignIn = useGitHubStore((s) => s.cancelSignIn);
  const keyringAvailable = useGitHubStore(
    (s) => s.tokenStorage?.keyringAvailable ?? true,
  );
  const [remember, setRemember] = useState(true);

  if (signIn.kind === "waiting") {
    return (
      <SignInCodePrompt
        code={signIn.code}
        compact={compact}
        onCancel={cancelSignIn}
      />
    );
  }

  const connect = (
    <Button
      onClick={() => void startSignIn(remember)}
      disabled={signIn.kind === "starting"}
      className={cn(compact && "w-full")}
    >
      {signIn.kind === "starting" ? (
        <CircleNotchIcon className="animate-spin" />
      ) : (
        <GithubLogoIcon />
      )}
      Connect GitHub
    </Button>
  );

  if (keyringAvailable) return connect;

  return (
    <div className="space-y-3">
      {connect}
      <RememberChoice remember={remember} onChange={setRemember} />
    </div>
  );
}

/**
 * Shown on computers without a keyring, where the sign-in can only be saved
 * in a file or not at all.
 */
function RememberChoice({
  remember,
  onChange,
}: {
  remember: boolean;
  onChange: (remember: boolean) => void;
}) {
  const id = useId();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="font-normal">
        <Checkbox
          id={id}
          checked={remember}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
        Remember this sign-in on this computer
      </Label>
      <p className="text-muted-foreground text-xs leading-5">
        {remember
          ? "This computer has no keyring, so it's saved in a file only your account can read."
          : "You'll connect again each time you open Netherstone."}
      </p>
    </div>
  );
}

function SignInCodePrompt({
  code,
  compact,
  onCancel,
}: {
  code: GitHubSignInCode;
  compact: boolean;
  onCancel: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyAndOpen() {
    try {
      await navigator.clipboard.writeText(code.userCode);
      setCopied(true);
    } catch {
      // The code stays on screen to type in by hand.
    }
    await openUrl(code.verificationUri);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Enter this code on GitHub to connect your account.
      </p>
      <div
        className={cn(
          "flex flex-wrap items-center gap-3",
          compact && "flex-col items-stretch gap-2",
        )}
      >
        <span className="rounded-lg border bg-background px-4 py-2 text-center font-mono font-semibold text-lg tracking-[0.2em]">
          {code.userCode}
        </span>
        <Button onClick={() => void copyAndOpen()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          Copy code and open GitHub
        </Button>
      </div>
      <div className="flex items-center gap-3 text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-1.5">
          <CircleNotchIcon className="size-3.5 animate-spin" />
          Waiting for you to approve on GitHub
        </span>
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0 text-xs"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
