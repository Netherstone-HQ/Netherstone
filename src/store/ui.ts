import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isPathWithin, isSamePath } from "@/lib/drawing-files";
import { renamedLocalStorage } from "./renamed-storage";

type NavItem = "notes" | "search" | "tags" | "settings" | null;
export type SettingsCategory =
  | "general"
  | "appearance"
  | "editor"
  | "files"
  | "sync"
  | "vault"
  | "shortcuts"
  | "about";
export type AppMode = "notes" | "canvas";

const MAX_RECENT_FILES_HISTORY = 25;

export interface RecentFileEntry {
  path: string;
  name: string;
}

interface UIState {
  // ── Left Sidebar ───────────────────────────────────────────────────────────
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;

  // ── Right Sidebar ──────────────────────────────────────────────────────────
  isRightSidebarOpen: boolean;
  setRightSidebarOpen: (open: boolean) => void;
  toggleRightSidebar: () => void;

  // ── Notes Browser Panel ────────────────────────────────────────────────────
  isBrowserPanelOpen: boolean;
  setBrowserPanelOpen: (open: boolean) => void;
  toggleBrowserPanel: () => void;
  browserLastUrl: string | null;
  setBrowserLastUrl: (url: string | null) => void;

  // ── Canvas Browser Panel ───────────────────────────────────────────────────
  isCanvasBrowserPanelOpen: boolean;
  setCanvasBrowserPanelOpen: (open: boolean) => void;
  toggleCanvasBrowserPanel: () => void;
  canvasBrowserLastUrl: string | null;
  setCanvasBrowserLastUrl: (url: string | null) => void;

  // ── Navigation ─────────────────────────────────────────────────────────────
  activeNavItem: NavItem;
  setActiveNavItem: (item: NavItem) => void;
  /** The category shown when Settings is open. */
  settingsCategory: SettingsCategory;
  /** Opens Settings at `category`. */
  openSettings: (category?: SettingsCategory) => void;

  // ── Recent Files ───────────────────────────────────────────────────────────
  recentFiles: RecentFileEntry[];
  pushRecentFile: (file: RecentFileEntry) => void;
  updateRecentFilePath: (previousPath: string, nextPath: string) => void;
  removeRecentFile: (path: string) => void;
  clearRecentFiles: () => void;

  // ── Search Modal ───────────────────────────────────────────────────────────
  isSearchModalOpen: boolean;
  setSearchModalOpen: (open: boolean) => void;
  toggleSearchModal: () => void;

  // ── App Mode ───────────────────────────────────────────────────────────────
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;

  // ── Canvas ─────────────────────────────────────────────────────────────────
  /** The `.excalidraw` file open in canvas mode, or null for a scratch canvas. */
  activeDrawingPath: string | null;
  /**
   * Changes whenever a different drawing is opened, so the canvas remounts.
   * Renaming or first-saving the open drawing keeps it.
   */
  drawingSessionKey: number;
  /** Opens `path` (or a fresh scratch canvas) in a new canvas session. */
  openDrawing: (path: string | null) => void;
  /** Points the open canvas at a new path without reloading it. */
  setActiveDrawingPath: (path: string | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // ── Left Sidebar ───────────────────────────────────────────────────────────
      isSidebarOpen: true,
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      toggleSidebar: () =>
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      sidebarWidth: 256,
      setSidebarWidth: (width) => set({ sidebarWidth: width }),

      // ── Right Sidebar ──────────────────────────────────────────────────────────
      isRightSidebarOpen: true,
      setRightSidebarOpen: (open) => set({ isRightSidebarOpen: open }),
      toggleRightSidebar: () =>
        set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),

      // ── Notes Browser Panel ────────────────────────────────────────────────────
      isBrowserPanelOpen: false,
      setBrowserPanelOpen: (open) => set({ isBrowserPanelOpen: open }),
      toggleBrowserPanel: () =>
        set((state) => ({ isBrowserPanelOpen: !state.isBrowserPanelOpen })),
      browserLastUrl: null,
      setBrowserLastUrl: (url) => set({ browserLastUrl: url }),

      // ── Canvas Browser Panel ───────────────────────────────────────────────────
      isCanvasBrowserPanelOpen: false,
      setCanvasBrowserPanelOpen: (open) =>
        set({ isCanvasBrowserPanelOpen: open }),
      toggleCanvasBrowserPanel: () =>
        set((state) => ({
          isCanvasBrowserPanelOpen: !state.isCanvasBrowserPanelOpen,
        })),
      canvasBrowserLastUrl: null,
      setCanvasBrowserLastUrl: (url) => set({ canvasBrowserLastUrl: url }),

      // ── Navigation ─────────────────────────────────────────────────────────────
      activeNavItem: "notes",
      setActiveNavItem: (item) => set({ activeNavItem: item }),
      settingsCategory: "general",
      openSettings: (category) =>
        set((state) => ({
          activeNavItem: "settings",
          settingsCategory: category ?? state.settingsCategory,
        })),

      // ── Recent Files ───────────────────────────────────────────────────────────
      recentFiles: [],
      pushRecentFile: (file) =>
        set((state) => ({
          recentFiles: [
            file,
            ...state.recentFiles.filter(
              (entry) => !isSamePath(entry.path, file.path),
            ),
          ].slice(0, MAX_RECENT_FILES_HISTORY),
        })),
      updateRecentFilePath: (previousPath, nextPath) =>
        set((state) => ({
          recentFiles: state.recentFiles.map((entry) =>
            isSamePath(entry.path, previousPath)
              ? {
                  ...entry,
                  path: nextPath,
                  name: nextPath.split(/[\\/]/).pop() ?? entry.name,
                }
              : entry,
          ),
        })),
      // Removing a folder also removes the recent files inside it.
      removeRecentFile: (path) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter(
            (entry) => !isPathWithin(entry.path, path),
          ),
        })),
      clearRecentFiles: () => set({ recentFiles: [] }),

      // ── Search Modal ───────────────────────────────────────────────────────────
      isSearchModalOpen: false,
      setSearchModalOpen: (open) => set({ isSearchModalOpen: open }),
      toggleSearchModal: () =>
        set((state) => ({ isSearchModalOpen: !state.isSearchModalOpen })),

      // ── App Mode ───────────────────────────────────────────────────────────────
      appMode: "notes",
      setAppMode: (mode) => set({ appMode: mode }),

      // ── Canvas ─────────────────────────────────────────────────────────────────
      activeDrawingPath: null,
      drawingSessionKey: 0,
      openDrawing: (path) =>
        set((state) => ({
          activeDrawingPath: path,
          drawingSessionKey: state.drawingSessionKey + 1,
        })),
      setActiveDrawingPath: (path) => set({ activeDrawingPath: path }),
    }),
    {
      name: "netherstone-ui",
      storage: renamedLocalStorage("netherite-ui"),
      partialize: (state) => ({
        isSidebarOpen: state.isSidebarOpen,
        isRightSidebarOpen: state.isRightSidebarOpen,
        isBrowserPanelOpen: state.isBrowserPanelOpen,
        browserLastUrl: state.browserLastUrl,
        isCanvasBrowserPanelOpen: state.isCanvasBrowserPanelOpen,
        canvasBrowserLastUrl: state.canvasBrowserLastUrl,
        activeNavItem: state.activeNavItem,
        recentFiles: state.recentFiles,
        sidebarWidth: state.sidebarWidth,
        appMode: state.appMode,
        activeDrawingPath: state.activeDrawingPath,
      }),
    },
  ),
);
