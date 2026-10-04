import { create } from "zustand";
import { persist } from "zustand/middleware";
import { renamedLocalStorage } from "./renamed-storage";

// ── Types ───────────────────────────────────────────────────────────────────

export type ThemePreference = "light" | "dark" | "system";
export type MediaInsertionPreference = "vault-import" | "local-reference";
export type ReadingFont = "newsreader" | "geist" | "system";
export type TextSize = "small" | "default" | "large";
export type ContentWidth = "narrow" | "default" | "wide";
export type NewShardLocation = "vault-root" | "current-folder";
/** Minutes between automatic syncs. */
export type SyncInterval = 5 | 15 | 30 | 60;

/** Everything the user can change in Settings (and onboarding). */
export interface Preferences {
  // ── General ─────────────────────────────────────────────────────────────────
  reopenLastShard: boolean;
  showRecentFiles: boolean;
  recentFilesLimit: number;
  confirmBeforeDelete: boolean;

  // ── Appearance ──────────────────────────────────────────────────────────────
  theme: ThemePreference;
  readingFont: ReadingFont;
  textSize: TextSize;
  contentWidth: ContentWidth;

  // ── Editor ──────────────────────────────────────────────────────────────────
  spellcheck: boolean;
  newShardLocation: NewShardLocation;
  showWordCount: boolean;

  // ── Files & attachments ─────────────────────────────────────────────────────
  mediaInsertionPreference: MediaInsertionPreference;

  // ── Sync & backup ───────────────────────────────────────────────────────────
  autoSync: boolean;
  autoSyncInterval: SyncInterval;

  // ── Updates ─────────────────────────────────────────────────────────────────
  betaUpdates: boolean;
}

interface SettingsState extends Preferences {
  /** Sets one preference, keeping it within its allowed values. */
  setPreference: <K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) => void;
  setTheme: (theme: ThemePreference) => void;
  setMediaInsertionPreference: (preference: MediaInsertionPreference) => void;
  setRecentFilesLimit: (limit: number) => void;

  // ── Onboarding ──────────────────────────────────────────────────────────────
  /** ISO time the welcome flow was finished, or null if it never was. */
  onboardingCompletedAt: string | null;
  completeOnboarding: () => void;
  /** Shows the welcome flow again on next launch. */
  resetOnboarding: () => void;

  // ── Utilities ───────────────────────────────────────────────────────────────
  /** Restores every preference. Leaves onboarding alone. */
  resetSettings: () => void;
}

// ── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_MEDIA_INSERTION_PREFERENCE: MediaInsertionPreference =
  "vault-import";
export const DEFAULT_RECENT_FILES_LIMIT = 3;
export const MIN_RECENT_FILES_LIMIT = 1;
export const MAX_RECENT_FILES_LIMIT = 20;
export const SYNC_INTERVALS: SyncInterval[] = [5, 15, 30, 60];

/** True for versions with a pre-release suffix, like 0.2.0-beta.1. */
export function isPrerelease(version: string): boolean {
  return version.includes("-");
}

export const DEFAULT_PREFERENCES: Preferences = {
  reopenLastShard: true,
  showRecentFiles: true,
  recentFilesLimit: DEFAULT_RECENT_FILES_LIMIT,
  confirmBeforeDelete: true,

  theme: "dark",
  readingFont: "newsreader",
  textSize: "default",
  contentWidth: "default",

  spellcheck: true,
  newShardLocation: "current-folder",
  showWordCount: false,

  mediaInsertionPreference: DEFAULT_MEDIA_INSERTION_PREFERENCE,

  autoSync: true,
  autoSyncInterval: 5,

  // Someone who installed a beta wants the next beta too.
  betaUpdates: isPrerelease(__APP_VERSION__),
};

const PREFERENCE_KEYS = Object.keys(
  DEFAULT_PREFERENCES,
) as (keyof Preferences)[];

/** The theme key used before themes moved into this store. */
const LEGACY_THEME_STORAGE_KEY = "vite-ui-theme";

function clampRecentFilesLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_RECENT_FILES_LIMIT;

  return Math.min(
    MAX_RECENT_FILES_LIMIT,
    Math.max(MIN_RECENT_FILES_LIMIT, Math.round(limit)),
  );
}

function normalize<K extends keyof Preferences>(
  key: K,
  value: Preferences[K],
): Preferences[K] {
  if (key === "recentFilesLimit") {
    return clampRecentFilesLimit(value as number) as Preferences[K];
  }
  if (
    key === "autoSyncInterval" &&
    !SYNC_INTERVALS.includes(value as SyncInterval)
  ) {
    return DEFAULT_PREFERENCES.autoSyncInterval as Preferences[K];
  }
  return value;
}

function readLegacyTheme(): ThemePreference | undefined {
  try {
    const value = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    // Storage unavailable; fall back to the default.
  }
  return undefined;
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_PREFERENCES,

      setPreference: (key, value) =>
        set({ [key]: normalize(key, value) } as Partial<Preferences>),
      setTheme: (theme) => set({ theme }),
      setMediaInsertionPreference: (preference) =>
        set({ mediaInsertionPreference: preference }),
      setRecentFilesLimit: (limit) =>
        set({ recentFilesLimit: clampRecentFilesLimit(limit) }),

      // ── Onboarding ──────────────────────────────────────────────────────────
      onboardingCompletedAt: null,
      completeOnboarding: () =>
        set({ onboardingCompletedAt: new Date().toISOString() }),
      resetOnboarding: () => set({ onboardingCompletedAt: null }),

      // ── Utilities ───────────────────────────────────────────────────────────
      resetSettings: () => set({ ...DEFAULT_PREFERENCES }),
    }),
    {
      name: "netherstone-settings",
      storage: renamedLocalStorage("netherite-settings"),
      version: 2,
      partialize: (state) => {
        const saved: Partial<Preferences> & {
          onboardingCompletedAt: string | null;
        } = { onboardingCompletedAt: state.onboardingCompletedAt };
        for (const key of PREFERENCE_KEYS) {
          (saved as Record<string, unknown>)[key] = state[key];
        }
        return saved;
      },
      // Version 0 held only the media and recent-files preferences, and the
      // theme lived in its own key, so carry it over.
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<Preferences>;
        if (version < 1) {
          const theme = readLegacyTheme();
          if (theme) state.theme = theme;
        }
        // Version 1 hid the Recent list with a count of 0; it has a switch now.
        if (version < 2 && state.recentFilesLimit === 0) {
          state.showRecentFiles = false;
          state.recentFilesLimit = DEFAULT_RECENT_FILES_LIMIT;
        }
        return state as SettingsState;
      },
      // First launch with no saved settings at all: still honor the old key.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SettingsState>;
        const theme =
          saved.theme ?? (persisted ? undefined : readLegacyTheme());
        return { ...current, ...saved, ...(theme ? { theme } : {}) };
      },
    },
  ),
);
