import { invoke } from "@tauri-apps/api/core";

export type GitHubAccount = {
  login: string;
  name: string | null;
  avatarUrl: string | null;
};

export type GitHubSignInCode = {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
};

export function getGitHubAccount() {
  return invoke<GitHubAccount | null>("github_get_account");
}

/** Where the sign-in is kept: a keyring, a private file, or memory only. */
export type GitHubTokenStorage = "keyring" | "file" | "memory";

export type GitHubTokenStorageStatus = {
  /**
   * Whether this computer has a keyring. Some Linux desktops have none; the
   * user then chooses between a private file and connecting each time.
   */
  keyringAvailable: boolean;
  /** Where the current sign-in is kept, if signed in. */
  current: GitHubTokenStorage | null;
};

export function getGitHubTokenStorage() {
  return invoke<GitHubTokenStorageStatus>("github_token_storage");
}

/** Asks GitHub for a code the user enters on github.com. */
export function startGitHubSignIn() {
  return invoke<GitHubSignInCode>("github_start_sign_in");
}

/**
 * Resolves once the user approves the code on GitHub, with `null` if the
 * sign-in was cancelled first. Without a keyring, `remember: false` keeps the
 * sign-in only until the app quits instead of saving it to a file.
 */
export function finishGitHubSignIn(remember = true) {
  return invoke<GitHubAccount | null>("github_finish_sign_in", { remember });
}

export function cancelGitHubSignIn() {
  return invoke<void>("github_cancel_sign_in");
}

export function signOutOfGitHub() {
  return invoke<void>("github_sign_out");
}

export function errorMessage(error: unknown) {
  return typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Something went wrong.";
}

export type GitHubInstallation = {
  /** Whether the Netherstone GitHub App is installed on the user's account. */
  installed: boolean;
  /** Accounts the app is installed on that the user can see. */
  installedOn: string[];
  installUrl: string;
};

export function getGitHubInstallation() {
  return invoke<GitHubInstallation>("github_get_installation");
}
