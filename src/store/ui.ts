import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  isPathWithin,
  isSamePath,
  remapPathAfterMove,
} from "@/lib/drawing-files";
import { renamedLocalStorage } from "./renamed-storage";
import { useShardScrollStore } from "./shard-scroll";

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
export type AppMode = "notes" | "tags" | "gallery" | "canvas" | "data";
/** The modes on the rail, in order. */
export const RAIL_MODES = ["editor", "tags", "gallery", "canvas", "data"] as const;
export type RailMode = (typeof RAIL_MODES)[number];
/**
 * Sidebar sections that collapse: Pinned and Recent on the left,
 * the others on the right.
 */
export type SidebarSection =
  | "pinned"
  | "recent"
  | "outline"
  | "links"
  | "linkedFrom"
  | "details";

const MAX_RECENT_FILES_HISTORY = 25;

export interface RecentFileEntry {
  path: string;
  name: string;
}

interface UIState {
  // ── Left Sidebar ───────────────────────────────────────────────────────────
  isSidebarOpen: boolean;
  /**
   * The left sidebar's state in the other modes while Canvas, which opens
   * with it hidden, is on screen.
   */
  isSidebarOpenOutsideCanvas: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
  /** Which sidebar sections are collapsed. Missing ones are expanded. */
  collapsedSections: Partial<Record<SidebarSection, boolean>>;
  toggleSection: (section: SidebarSection) => void;
  /**
   * A folder to show in the file tree: its folders open down to it, and it
   * scrolls into view and flashes. A new object each time, so picking the
   * same folder again shows it again.
   */
  treeReveal: { path: string } | null;
  /** Opens the left sidebar on `path` in the file tree. */
  revealInTree: (path: string) => void;
  /** Folders open in the file tree, across vaults and restarts. */
  openFolders: string[];
  setFolderOpen: (path: string, open: boolean) => void;
  /** Closes every folder in the vault at `vaultPath`. */
  collapseAllFolders: (vaultPath: string) => void;
  /** Ends `reveal`, unless another one has replaced it. */
  endTreeReveal: (reveal: { path: string }) => void;

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
  /** A page the open panel should go to next. */
  browserUrlRequest: string | null;
  /** Shows a page in the browser panel, opening the panel if needed. */
  openInBrowserPanel: (url: string) => void;
  clearBrowserUrlRequest: () => void;

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
  /**
   * Points recent and pinned files, and open folders, at `nextPath` after a
   * rename or move.
   */
  remapRememberedPaths: (previousPath: string, nextPath: string) => void;
  /**
   * Drops recent and pinned files, and open folders, at or inside `path`
   * once it's deleted.
   */
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

/**
 * Shows `appMode`. Canvas gives the drawing the whole width: the left sidebar
 * hides on the way in (its toggle still shows it) and comes back as it was on
 * the way out.
 */
function switchAppMode(state: UIState, appMode: AppMode): Partial<UIState> {
  if (appMode === state.appMode) return {};
  if (appMode === "canvas") {
    return {
      appMode,
      isSidebarOpen: false,
      isSidebarOpenOutsideCanvas: state.isSidebarOpen,
    };
  }
  if (state.appMode === "canvas") {
    return { appMode, isSidebarOpen: state.isSidebarOpenOutsideCanvas };
  }
  return { appMode };
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // ── Left Sidebar ───────────────────────────────────────────────────────────
      isSidebarOpen: true,
      isSidebarOpenOutsideCanvas: true,
      setSidebarOpen: (open) => set({ isSidebarOpen: open }),
      toggleSidebar: () =>
        set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
      sidebarWidth: 256,
      setSidebarWidth: (width) => set({ sidebarWidth: width }),
      collapsedSections: {},
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
      openFolders: [],
      setFolderOpen: (path, open) =>
        set((state) => {
          const isOpen = state.openFolders.some((entry) =>
            isSamePath(entry, path),
          );
          if (open === isOpen) return {};
          return {
            openFolders: open
              ? [...state.openFolders, path]
              : state.openFolders.filter((entry) => !isSamePath(entry, path)),
          };
        }),
      collapseAllFolders: (vaultPath) =>
        set((state) => ({
          openFolders: state.openFolders.filter(
            (entry) => !isPathWithin(entry, vaultPath),
          ),
        })),

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
      browserUrlRequest: null,
      openInBrowserPanel: (url) =>
        set((state) =>
          // A closed panel starts on its last URL, so that's all it needs.
          state.isBrowserPanelOpen
            ? { browserUrlRequest: url }
            : {
                isBrowserPanelOpen: true,
                browserLastUrl: url,
                browserUrlRequest: null,
              },
        ),
      clearBrowserUrlRequest: () => set({ browserUrlRequest: null }),

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
      remapRememberedPaths: (previousPath, nextPath) => {
        useShardScrollStore.getState().remapPositions(previousPath, nextPath);
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
            openFolders: state.openFolders.map(
              (path) => remapPathAfterMove(path, previousPath, nextPath) ?? path,
            ),
          };
        });
      },
      // Removing a folder also removes the files inside it.
      forgetRememberedPaths: (path) => {
        useShardScrollStore.getState().forgetPositions(path);
        set((state) => ({
          recentFiles: state.recentFiles.filter(
            (entry) => !isPathWithin(entry.path, path),
          ),
          pinnedFiles: state.pinnedFiles.filter(
            (entry) => !isPathWithin(entry.path, path),
          ),
          openFolders: state.openFolders.filter(
            (entry) => !isPathWithin(entry, path),
          ),
        }));
      },

      // ── Search Modal ───────────────────────────────────────────────────────────
      isSearchModalOpen: false,
      setSearchModalOpen: (open) => set({ isSearchModalOpen: open }),
      toggleSearchModal: () =>
        set((state) => ({ isSearchModalOpen: !state.isSearchModalOpen })),

      // ── App Mode ───────────────────────────────────────────────────────────────
      appMode: "notes",
      setAppMode: (mode) => set((state) => switchAppMode(state, mode)),
      openMode: (mode) =>
        set((state) => ({
          ...switchAppMode(state, mode === "editor" ? "notes" : mode),
          activeNavItem: null,
        })),

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
        isSidebarOpenOutsideCanvas: state.isSidebarOpenOutsideCanvas,
        isRightSidebarOpen: state.isRightSidebarOpen,
        isBrowserPanelOpen: state.isBrowserPanelOpen,
        browserLastUrl: state.browserLastUrl,
        isCanvasBrowserPanelOpen: state.isCanvasBrowserPanelOpen,
        canvasBrowserLastUrl: state.canvasBrowserLastUrl,
        activeNavItem: state.activeNavItem,
        recentFiles: state.recentFiles,
        pinnedFiles: state.pinnedFiles,
        sidebarWidth: state.sidebarWidth,
        collapsedSections: state.collapsedSections,
        openFolders: state.openFolders,
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
