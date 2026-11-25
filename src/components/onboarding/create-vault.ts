import { createVault } from "@/lib/commands/vault";
import { errorMessage } from "@/lib/github-account";
import { openVault } from "@/lib/open-vault";
import { copy } from "./copy";
import { addStartHere } from "./start-here";

export type VaultChoice = {
  path: string;
  kind: "kept" | "created" | "opened" | "restored";
  /** The guide written into a new vault, opened when onboarding ends. */
  startHerePath?: string;
};

/** Turns a failure from `create_vault` into a sentence from copy.ts. */
export function vaultErrorText(error: unknown) {
  const code = errorMessage(error);
  const errors: Record<string, string> = copy.vault.errors;
  if (code in errors) return errors[code];
  console.error("[Netherstone] Couldn't set up the vault:", error);
  return copy.vault.errors.unknown;
}

/** Makes an empty vault with the Start here guide. */
export async function createEmptyVault(location: string, name: string): Promise<VaultChoice> {
  const path = await createVault(location, name);
  await openVault(path);
  const startHerePath = await addStartHere(path);
  return { path, kind: "created", startHerePath };
}
