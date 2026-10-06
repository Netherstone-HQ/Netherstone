import { useEffect } from "react";

import { useSettingsStore } from "@/store/settings";
import type { ThemePreference } from "@/store/settings";
import { isNamedTheme, resolveThemeMode } from "./themes";

/**
 * Keeps the document in step with the Appearance settings: the light/dark
 * class, the named theme (`data-theme`), and the reading font, size and width the editor reads from CSS.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);
  const readingFont = useSettingsStore((s) => s.readingFont);
  const textSize = useSettingsStore((s) => s.textSize);
  const contentWidth = useSettingsStore((s) => s.contentWidth);

  useEffect(() => {
    const { dataset } = window.document.documentElement;
    dataset.readingFont = readingFont;
    dataset.textSize = textSize;
    dataset.contentWidth = contentWidth;
  }, [readingFont, textSize, contentWidth]);

  useEffect(() => {
    const root = window.document.documentElement;
    const apply = (resolved: "light" | "dark") => {
      root.classList.remove("light", "dark");
      root.classList.add(resolved);
    };

    // Named themes are dark themes that recolor the dark tokens.
    if (isNamedTheme(theme)) root.dataset.theme = theme;
    else delete root.dataset.theme;

    if (theme !== "system") {
      apply(resolveThemeMode(theme, false));
      return;
    }

    const query = window.matchMedia("(prefers-color-scheme: dark)");
    apply(resolveThemeMode(theme, query.matches));
    const onChange = (e: MediaQueryListEvent) =>
      apply(resolveThemeMode(theme, e.matches));
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [theme]);

  return <>{children}</>;
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
