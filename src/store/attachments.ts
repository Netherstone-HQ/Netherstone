import { create } from "zustand";

import { reconcileAttachments, type AttachmentReport } from "@/lib/commands";

interface AttachmentReportState {
  /** The vault the report describes. */
  vaultPath: string | null;
  report: AttachmentReport | null;
  isChecking: boolean;
  error: string | null;
  /**
   * Reconciles the vault's attachments and stores the report. Returns null
   * if the check failed or another vault was checked meanwhile.
   */
  check: (vaultPath: string) => Promise<AttachmentReport | null>;
}

export const useAttachmentReportStore = create<AttachmentReportState>(
  (set, get) => ({
    vaultPath: null,
    report: null,
    isChecking: false,
    error: null,
    check: async (vaultPath) => {
      set((state) => ({
        vaultPath,
        isChecking: true,
        error: null,
        report: state.vaultPath === vaultPath ? state.report : null,
      }));

      try {
        const report = await reconcileAttachments(vaultPath);
        if (get().vaultPath !== vaultPath) return null;

        set({ report, isChecking: false });
        return report;
      } catch (error) {
        console.error("[Netherstone] Attachment check failed:", error);
        if (get().vaultPath === vaultPath) {
          set({
            isChecking: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return null;
      }
    },
  }),
);
