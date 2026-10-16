import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isSamePath } from "@/lib/drawing-files";
import { renamedLocalStorage } from "./renamed-storage";

const MAX_RECENT_VAULTS = 5;

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
  /** Vaults opened on this computer, newest first, to switch back to. */
  recentVaults: string[];
  /** Drops a vault from the recent list, once its folder is gone. */
  forgetRecentVault: (path: string) => void;

  // ── File Tree (Phase 2) ────────────────────────────────────────────────────
  fileTree: FileTreeNode[];
  setFileTree: (tree: FileTreeNode[]) => void;

  // ── Loading State ──────────────────────────────────────────────────────────
  isVaultLoading: boolean;
  setVaultLoading: (loading: boolean) => void;

  // ── New Folder ─────────────────────────────────────────────────────────────
  /** The folder a new folder is being named in, shown as a row in the tree. */
  newFolderParent: string | null;
  setNewFolderParent: (path: string | null) => void;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useVaultStore = create<VaultState>()(
  persist(
    (set) => ({
      // ── Vault Path ─────────────────────────────────────────────────────────────
      currentVaultPath: null,
      setCurrentVaultPath: (path) =>
        set((state) => ({
          currentVaultPath: path,
          recentVaults: path
            ? [
                path,
                ...state.recentVaults.filter((v) => !isSamePath(v, path)),
              ].slice(0, MAX_RECENT_VAULTS)
            : state.recentVaults,
        })),
      clearVault: () => set({ currentVaultPath: null, fileTree: [] }),
      recentVaults: [],
      forgetRecentVault: (path) =>
        set((state) => ({
          recentVaults: state.recentVaults.filter((v) => !isSamePath(v, path)),
        })),

      // ── File Tree (Phase 2) ────────────────────────────────────────────────────
      fileTree: [],
      setFileTree: (tree) => set({ fileTree: tree }),

      // ── Loading State ──────────────────────────────────────────────────────────
      isVaultLoading: false,
      setVaultLoading: (loading) => set({ isVaultLoading: loading }),

      // ── New Folder ─────────────────────────────────────────────────────────────
      newFolderParent: null,
      setNewFolderParent: (path) => set({ newFolderParent: path }),
    }),
    {
      name: "netherstone-vault",
      storage: renamedLocalStorage("netherite-vault"),
      // The tree is always rebuilt from disk.
      partialize: (state) => ({
        currentVaultPath: state.currentVaultPath,
        recentVaults: state.recentVaults,
      }),
    },
  ),
);
