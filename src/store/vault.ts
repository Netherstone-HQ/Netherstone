import { create } from "zustand";
import { persist } from "zustand/middleware";
import { renamedLocalStorage } from "./renamed-storage";

// ── Types ───────────────────────────────────────────────────────────────────

export interface FileTreeNode {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: FileTreeNode[];
}

interface VaultState {
  // ── Vault Path ─────────────────────────────────────────────────────────────
  currentVaultPath: string | null;
  setCurrentVaultPath: (path: string | null) => void;
  clearVault: () => void;

  // ── File Tree (Phase 2) ────────────────────────────────────────────────────
  fileTree: FileTreeNode[];
  setFileTree: (tree: FileTreeNode[]) => void;

  // ── Loading State ──────────────────────────────────────────────────────────
  isVaultLoading: boolean;
  setVaultLoading: (loading: boolean) => void;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useVaultStore = create<VaultState>()(
  persist(
    (set) => ({
      // ── Vault Path ─────────────────────────────────────────────────────────────
      currentVaultPath: null,
      setCurrentVaultPath: (path) => set({ currentVaultPath: path }),
      clearVault: () => set({ currentVaultPath: null, fileTree: [] }),

      // ── File Tree (Phase 2) ────────────────────────────────────────────────────
      fileTree: [],
      setFileTree: (tree) => set({ fileTree: tree }),

      // ── Loading State ──────────────────────────────────────────────────────────
      isVaultLoading: false,
      setVaultLoading: (loading) => set({ isVaultLoading: loading }),
    }),
    {
      name: "netherstone-vault",
      storage: renamedLocalStorage("netherite-vault"),
      // Only persist the vault path — the tree is always rebuilt from disk.
      partialize: (state) => ({ currentVaultPath: state.currentVaultPath }),
    },
  ),
);
