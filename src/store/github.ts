import { openUrl } from "@tauri-apps/plugin-opener";
import { create } from "zustand";

import {
  cancelGitHubSignIn,
  errorMessage,
  finishGitHubSignIn,
  getGitHubAccount,
  getGitHubInstallation,
  getGitHubTokenStorage,
  type GitHubInstallation,
  type GitHubAccount,
  type GitHubSignInCode,
  type GitHubTokenStorageStatus,
  signOutOfGitHub,
  startGitHubSignIn,
} from "@/lib/github-account";

export type GitHubSignInState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; code: GitHubSignInCode };

interface GitHubState {
  account: GitHubAccount | null;
  /** False until the stored account has been read once. */
  loaded: boolean;
  signIn: GitHubSignInState;
  error: string | null;
  /** The GitHub App's installation on the account; `null` until checked. */
  installation: GitHubInstallation | null;
  installationError: string | null;
  /** Where the sign-in is kept; `null` until read. */
  tokenStorage: GitHubTokenStorageStatus | null;
  load: () => Promise<void>;
  checkInstallation: () => Promise<void>;
  /** `remember` only matters on a computer without a keyring. */
  startSignIn: (remember?: boolean) => Promise<void>;
  cancelSignIn: () => void;
  signOut: () => Promise<void>;
}

// Results from a sign-in the user already cancelled or restarted are ignored.
let attempt = 0;

async function readTokenStorage() {
  try {
    return (await getGitHubTokenStorage()) ?? null;
  } catch {
    return null;
  }
}

export const useGitHubStore = create<GitHubState>((set, get) => ({
  account: null,
  loaded: false,
  signIn: { kind: "idle" },
  error: null,
  installation: null,
  installationError: null,
  tokenStorage: null,

  load: async () => {
    try {
      const account = await getGitHubAccount();
      set({ account, loaded: true, tokenStorage: await readTokenStorage() });
    } catch (e) {
      set({ account: null, loaded: true, error: errorMessage(e) });
    }
  },

  checkInstallation: async () => {
    try {
      const installation = await getGitHubInstallation();
      set({ installation, installationError: null });
    } catch (e) {
      set({ installationError: errorMessage(e) });
    }
  },

  startSignIn: async (remember = true) => {
    const current = ++attempt;
    const isCurrent = () => current === attempt;
    set({ error: null, signIn: { kind: "starting" } });

    try {
      const code = await startGitHubSignIn();
      if (!isCurrent()) return;
      set({ signIn: { kind: "waiting", code } });

      const account = await finishGitHubSignIn(remember);
      if (!isCurrent()) return;
      if (!account) {
        set({ signIn: { kind: "idle" } });
        return;
      }
      set({
        account,
        signIn: { kind: "idle" },
        installation: null,
        tokenStorage: await readTokenStorage(),
      });

      // Continue straight to installing the app while the user is still in
      // the browser, so connecting feels like one step.
      await get().checkInstallation();
      const installation = get().installation;
      if (installation && !installation.installed) {
        void openUrl(installation.installUrl);
      }
    } catch (e) {
      if (!isCurrent()) return;
      set({ error: errorMessage(e), signIn: { kind: "idle" } });
    }
  },

  cancelSignIn: () => {
    attempt += 1;
    void cancelGitHubSignIn();
    set({ signIn: { kind: "idle" } });
  },

  signOut: async () => {
    set({ error: null });
    try {
      await signOutOfGitHub();
      set({
        account: null,
        installation: null,
        installationError: null,
        tokenStorage: await readTokenStorage(),
      });
    } catch (e) {
      set({ error: errorMessage(e) });
    }
  },
}));
