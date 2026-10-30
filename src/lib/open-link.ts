import { create } from "zustand";

import type { VaultChoice } from "@/components/onboarding/VaultStep";
import {
  cancelLink,
  createFromLink,
  finishLink,
  listLink,
  type LinkListing,
  type LinkProgress,
  type LinkRefusal,
} from "@/lib/commands";
import type { ImportProgress } from "@/lib/import/engine";
import { openEditorFile } from "@/lib/open-editor-file";
import { openVault } from "@/lib/open-vault";
import { refreshVault } from "@/lib/refresh-vault";

/**
 * Netherstone links (`netherstone://open/<address>`): a template from
 * netherstone.app or a public Markdown folder on github.com, opened as a new
 * vault. Rust reads the address, lists what's there and downloads it
 * (open_source/); this asks the person first and, for a folder that isn't a
 * template, brings the downloaded files in through the Markdown import.
 */
export type LinkStep =
  | { kind: "listing" }
  | { kind: "ready"; listing: LinkListing }
  | { kind: "downloading"; listing: LinkListing; progress: LinkProgress | null }
  | { kind: "adding"; listing: LinkListing; progress: ImportProgress | null }
  | { kind: "refused"; refusal: LinkRefusal; name: string | null };

interface OpenLinkState {
  /** The link's address, or null when no link is open. */
  address: string | null;
  step: LinkStep | null;
  /** Stops the Markdown import of a folder. */
  stopAdding: (() => void) | null;
}

export const useOpenLink = create<OpenLinkState>(() => ({
  address: null,
  step: null,
  stopAdding: null,
}));

/** Whether a link is downloading or being added now, so another must wait. */
export function isOpeningLink() {
  const kind = useOpenLink.getState().step?.kind;
  return kind === "downloading" || kind === "adding";
}

function setStep(address: string, step: LinkStep) {
  // A link closed or replaced meanwhile keeps its own state.
  if (useOpenLink.getState().address === address) useOpenLink.setState({ step });
}

function refusalOf(error: unknown): LinkRefusal {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string") return error as LinkRefusal;
  console.error("[Netherstone] Couldn't open the link:", error);
  return { code: "download-failed" };
}

/** Opens the dialog for a link Rust handed over and lists what it opens. */
export async function openLink(address: string) {
  useOpenLink.setState({ address, step: { kind: "listing" }, stopAdding: null });
  try {
    setStep(address, { kind: "ready", listing: await listLink(address) });
  } catch (error) {
    setStep(address, { kind: "refused", refusal: refusalOf(error), name: null });
  }
}

/** Closes the dialog, unless a download or an import is running. */
export function closeLink() {
  if (isOpeningLink()) return;
  useOpenLink.setState({ address: null, step: null, stopAdding: null });
  void finishLink().catch((error) => console.error("[Netherstone] Couldn't clean up after the link:", error));
}

/** Stops the download or the import running now. */
export function cancelOpeningLink() {
  const { step, stopAdding } = useOpenLink.getState();
  if (step?.kind === "downloading") void cancelLink();
  if (step?.kind === "adding") stopAdding?.();
}

/**
 * Create vault: downloads what the link opens into the vault `parent/name`,
 * then opens it. A problem with the folder name is thrown for the form to
 * show; any other shows in the dialog, and resolves to null.
 */
export async function createVaultFromLink(parent: string, name: string): Promise<VaultChoice | null> {
  const { address, step } = useOpenLink.getState();
  if (!address || step?.kind !== "ready") return null;
  const { listing } = step;

  setStep(address, { kind: "downloading", listing, progress: null });
  let created;
  try {
    created = await createFromLink(address, parent, name, (progress) =>
      setStep(address, { kind: "downloading", listing, progress }),
    );
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal.code === "vault") {
      setStep(address, { kind: "ready", listing });
      throw refusal.error;
    }
    if (refusal.code === "cancelled") {
      useOpenLink.setState({ step: null });
      closeLink();
    } else {
      setStep(address, { kind: "refused", refusal, name: listing.name });
    }
    return null;
  }

  let opens = created.firstShard;
  try {
    await openVault(created.vault);
    if (!listing.template) opens = await addFolder(address, listing, created.vault, created.sources);
  } finally {
    useOpenLink.setState({ step: null });
    closeLink();
  }
  if (opens) await openEditorFile(opens);
  return { path: created.vault, kind: "created" };
}

/**
 * Brings a downloaded folder into its new vault the way Import does, and
 * returns its README's shard, if it had one, to open.
 */
async function addFolder(
  address: string,
  listing: LinkListing,
  vault: string,
  sources: { path: string; relativePath: string; size: number }[],
) {
  const controller = new AbortController();
  useOpenLink.setState({ stopAdding: () => controller.abort() });
  setStep(address, { kind: "adding", listing, progress: null });
  const [{ runImport }, { appImportIO }] = await Promise.all([
    import("@/lib/import/engine"),
    import("@/lib/import/app-io"),
  ]);
  try {
    const report = await runImport({
      sources,
      targetDir: vault,
      io: appImportIO(vault),
      signal: controller.signal,
      onProgress: (progress) => setStep(address, { kind: "adding", listing, progress }),
    });
    for (const { source, error } of report.failed) {
      console.error(`[Netherstone] Couldn't add ${source}:`, error);
    }
    return report.created.find((shard) => /^readme\.md$/i.test(shard.source))?.path ?? null;
  } finally {
    await refreshVault(vault).catch((error) =>
      console.error("[Netherstone] Couldn't refresh the vault after adding the folder:", error),
    );
  }
}
