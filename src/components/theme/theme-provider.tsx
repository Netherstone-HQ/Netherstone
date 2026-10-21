import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useSyncExternalStore } from "react";

import { useSettingsStore } from "@/store/settings";
import type { ThemePreference } from "@/store/settings";
import { isNamedTheme, resolveThemeMode } from "./themes";

/**
 * Keeps the document in step with the Appearance settings: the light/dark
 * class, the named theme (`data-theme`), the reading font, size and width the
 * editor reads from CSS, and the webview's zoom.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);
  const readingFont = useSettingsStore((s) => s.readingFont);
  const textSize = useSettingsStore((s) => s.textSize);
  const contentWidth = useSettingsStore((s) => s.contentWidth);
  const zoom = useSettingsStore((s) => s.zoom);

  useEffect(() => {
    const { dataset } = window.document.documentElement;
    dataset.readingFont = readingFont;
    dataset.textSize = textSize;
    dataset.contentWidth = contentWidth;
  }, [readingFont, textSize, contentWidth]);

  useEffect(() => {
    if (!isTauri()) return;
    getCurrentWebview()
      .setZoom(zoom / 100)
      .catch((error) => console.error("Failed to set zoom:", error));
  }, [zoom]);

  const mode = useThemeMode();

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(mode);

    // Named themes recolor the light or dark tokens.
    if (isNamedTheme(theme)) root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme, mode]);

  return <>{children}</>;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToSystemTheme(onChange: () => void) {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const systemPrefersDark = () => window.matchMedia(DARK_QUERY).matches;

/** Whether the app draws light or dark right now, following the OS for "system". */
export function useThemeMode(): "light" | "dark" {
  const theme = useSettingsStore((s) => s.theme);
  const prefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    systemPrefersDark,
  );
  return resolveThemeMode(theme, prefersDark);
}

/** The theme setting. Onboarding and Settings both change it through here. */
export function useTheme(): {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
} {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  return { theme, setTheme };
}
