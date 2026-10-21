import { create } from "zustand";

import { findNestedVault, type NestedVault } from "@/lib/commands";

type Question = NestedVault & {
  folder: string;
  /** Opening an existing folder, or creating a new vault in it. */
  action: "open" | "create";
  answer: (path: string | null) => void;
};

/** The question the nested vault dialog shows, if any. */
export const useNestedVaultQuestion = create<{ question: Question | null }>(
  () => ({ question: null }),
);

/**
 * Checks that `folder` isn't inside another vault and has none inside it.
 * When it does, asks which one to use. Resolves with the folder to go on
 * with: `folder` itself, the other vault, or null when the user cancels.
 */
export async function chooseVaultFolder(
  folder: string,
  action: Question["action"],
): Promise<string | null> {
  const nested = await findNestedVault(folder).catch((error) => {
    // A failed check shouldn't keep the vault from opening.
    console.error("[Netherstone] Couldn't check for nested vaults:", error);
    return null;
  });
  if (!nested) return folder;

  return new Promise((resolve) => {
    useNestedVaultQuestion.setState({
      question: {
        ...nested,
        folder,
        action,
        answer: (path) => {
          useNestedVaultQuestion.setState({ question: null });
          resolve(path);
        },
      },
    });
  });
}
