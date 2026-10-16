import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isPathWithin,
  isSamePath,
  remapPathAfterMove,
} from "@/lib/drawing-files";
import { renamedLocalStorage } from "./renamed-storage";

type NavItem = "notes" | "search" | "settings" | null;
export type SettingsCategory =
  | "general"
  | "appearance"
  | "editor"
  | "files"
  | "sync"
  | "vault"
  | "shortcuts"
  | "about";
/** The editor is "notes"; the rail calls it Editor. */
export type AppMode = "notes" | "tags" | "canvas";
/** The modes on the rail, in order. */
export const RAIL_MODES = ["editor", "tags", "canvas"] as const;
export type RailMode = (typeof RAIL_MODES)[number];
/** Right sidebar sections that collapse. */
export type RightSidebarSection = "outline" | "metadata";
/** Left sidebar sections that collapse. */
export type LeftSidebarSection = "pinned" | "recent";

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
  /** Which left sidebar sections are collapsed. */
  collapsedSections: Record<LeftSidebarSection, boolean>;
  toggleSection: (section: LeftSidebarSection) => void;
  /**
   * A folder to show in the file tree: its folders open down to it, and it
   * scrolls into view and flashes. A new object each time, so picking the
   * same folder again shows it again.
   */
  treeReveal: { path: string } | null;
  /** Opens the left sidebar on `path` in the file tree. */
  revealInTree: (path: string) => void;
  /** Ends `reveal`, unless another one has replaced it. */
  endTreeReveal: (reveal: { path: string }) => void;

  // ── Right Sidebar ──────────────────────────────────────────────────────────
  isRightSidebarOpen: boolean;
  setRightSidebarOpen: (open: boolean) => void;
  toggleRightSidebar: () => void;
  /** Which collapsible right sidebar sections are expanded. */
  rightSidebarSections: Record<RightSidebarSection, boolean>;
  setRightSidebarSectionOpen: (
    section: RightSidebarSection,
    open: boolean,
  ) => void;

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

  // ── Recent and Pinned Files ────────────────────────────────────────────────
  recentFiles: RecentFileEntry[];
  pushRecentFile: (file: RecentFileEntry) => void;
  clearRecentFiles: () => void;
  /** Files pinned to the top of the sidebar, across vaults (shown per vault). */
  pinnedFiles: RecentFileEntry[];
  togglePinnedFile: (file: RecentFileEntry) => void;
  /** Points recent and pinned files at `nextPath` after a rename or move. */
  remapRememberedPaths: (previousPath: string, nextPath: string) => void;
  /** Drops recent and pinned files at or inside `path` once it's deleted. */
  forgetRememberedPaths: (path: string) => void;

  // ── Search Modal ───────────────────────────────────────────────────────────
  isSearchModalOpen: boolean;
  setSearchModalOpen: (open: boolean) => void;
  toggleSearchModal: () => void;

  // ── App Mode ───────────────────────────────────────────────────────────────
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  /** Shows a rail mode, closing Settings if it's open. */
  openMode: (mode: RailMode) => void;

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
      collapsedSections: { pinned: false, recent: false },
      toggleSection: (section) =>
        set((state) => ({
          collapsedSections: {
            ...state.collapsedSections,
            [section]: !state.collapsedSections[section],
          },
        })),
      treeReveal: null,
      revealInTree: (path) =>
        set({ isSidebarOpen: true, treeReveal: { path } }),
      endTreeReveal: (reveal) =>
        set((state) =>
          state.treeReveal === reveal ? { treeReveal: null } : {},
        ),

      // ── Right Sidebar ──────────────────────────────────────────────────────────
      isRightSidebarOpen: true,
      setRightSidebarOpen: (open) => set({ isRightSidebarOpen: open }),
      toggleRightSidebar: () =>
        set((state) => ({ isRightSidebarOpen: !state.isRightSidebarOpen })),
      rightSidebarSections: { outline: true, metadata: true },
      setRightSidebarSectionOpen: (section, open) =>
        set((state) => ({
          rightSidebarSections: {
            ...state.rightSidebarSections,
            [section]: open,
          },
        })),

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

      // ── Recent and Pinned Files ────────────────────────────────────────────────
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
      clearRecentFiles: () => set({ recentFiles: [] }),
      pinnedFiles: [],
      togglePinnedFile: (file) =>
        set((state) => ({
          pinnedFiles: state.pinnedFiles.some((entry) =>
            isSamePath(entry.path, file.path),
          )
            ? state.pinnedFiles.filter(
                (entry) => !isSamePath(entry.path, file.path),
              )
            : [...state.pinnedFiles, file],
        })),
      // Renaming or moving a folder also updates the files inside it.
      remapRememberedPaths: (previousPath, nextPath) =>
        set((state) => {
          const remap = (entry: RecentFileEntry) => {
            const path = remapPathAfterMove(entry.path, previousPath, nextPath);
            return path
              ? { path, name: path.split(/[\\/]/).pop() ?? entry.name }
              : entry;
          };
          return {
            recentFiles: state.recentFiles.map(remap),
            pinnedFiles: state.pinnedFiles.map(remap),
          };
        }),
      // Removing a folder also removes the files inside it.
      forgetRememberedPaths: (path) =>
        set((state) => ({
          recentFiles: state.recentFiles.filter(
            (entry) => !isPathWithin(entry.path, path),
          ),
          pinnedFiles: state.pinnedFiles.filter(
            (entry) => !isPathWithin(entry.path, path),
          ),
        })),

      // ── Search Modal ───────────────────────────────────────────────────────────
      isSearchModalOpen: false,
      setSearchModalOpen: (open) => set({ isSearchModalOpen: open }),
      toggleSearchModal: () =>
        set((state) => ({ isSearchModalOpen: !state.isSearchModalOpen })),

      // ── App Mode ───────────────────────────────────────────────────────────────
      appMode: "notes",
      setAppMode: (mode) => set({ appMode: mode }),
      openMode: (mode) =>
        set({
          appMode: mode === "editor" ? "notes" : mode,
          activeNavItem: null,
        }),

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
        rightSidebarSections: state.rightSidebarSections,
        isBrowserPanelOpen: state.isBrowserPanelOpen,
        browserLastUrl: state.browserLastUrl,
        isCanvasBrowserPanelOpen: state.isCanvasBrowserPanelOpen,
        canvasBrowserLastUrl: state.canvasBrowserLastUrl,
        activeNavItem: state.activeNavItem,
        recentFiles: state.recentFiles,
        pinnedFiles: state.pinnedFiles,
        sidebarWidth: state.sidebarWidth,
        collapsedSections: state.collapsedSections,
        appMode: state.appMode,
        activeDrawingPath: state.activeDrawingPath,
      }),
    },
  ),
);

/** The rail mode on screen, or null while Settings covers it. */
export function selectRailMode(state: UIState): RailMode | null {
  if (state.activeNavItem === "settings") return null;
  return state.appMode === "notes" ? "editor" : state.appMode;
}
