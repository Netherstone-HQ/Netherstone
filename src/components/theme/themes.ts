import type { ThemePreference } from "@/store/settings";

/** Colors for the small window drawn in each theme's picker swatch. */
export interface ThemeSwatchColors {
  background: string;
  panel: string;
  line: string;
  accent: string;
}

export interface ThemeOption {
  value: ThemePreference;
  label: string;
  /**
   * Swatch colors. Absent for "system", which draws light and dark split.
   */
  swatch?: ThemeSwatchColors;
}

export const LIGHT_SWATCH: ThemeSwatchColors = {
  background: "#f6f5f2",
  panel: "#eeebe5",
  line: "#d6d2ca",
  accent: "#2b6a5b",
};

export const DARK_SWATCH: ThemeSwatchColors = {
  background: "#141516",
  panel: "#1c1d1f",
  line: "#34363a",
  accent: "#4fa38e",
};

/**
 * Every theme in Settings, in order. Tyrant, Bloodline and Citadel are dark
 * themes: each recolors Basalt's dark tokens (App.css) under `data-theme`.
 */
export const THEMES: ThemeOption[] = [
  { value: "light", label: "Light", swatch: LIGHT_SWATCH },
  { value: "dark", label: "Dark", swatch: DARK_SWATCH },
  { value: "system", label: "Match system" },
  {
    value: "tyrant",
    label: "Tyrant",
    swatch: {
      background: "#0b100d",
      panel: "#0d1f15",
      line: "#24402f",
      accent: "#3ecf7a",
    },
  },
  {
    value: "bloodline",
    label: "Bloodline",
    swatch: {
      background: "#120808",
      panel: "#2e1416",
      line: "#4a2a2d",
      accent: "#b3333f",
    },
  },
  {
    value: "citadel",
    label: "Citadel",
    swatch: {
      background: "#2a2a2a",
      panel: "#2e2e2e",
      line: "#45453f",
      accent: "#d8d2c2",
    },
  },
];

/** The named dark themes, set on <html> as `data-theme`. */
export const NAMED_THEMES = ["tyrant", "bloodline", "citadel"] as const;
export type NamedTheme = (typeof NAMED_THEMES)[number];

export function isNamedTheme(theme: string): theme is NamedTheme {
  return (NAMED_THEMES as readonly string[]).includes(theme);
}

/** Whether a theme draws light or dark, for libraries that only know those. */
export function resolveThemeMode(
  theme: ThemePreference,
  prefersDark: boolean,
): "light" | "dark" {
  if (theme === "system") return prefersDark ? "dark" : "light";
  return theme === "light" ? "light" : "dark";
}
