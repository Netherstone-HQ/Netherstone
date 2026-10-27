import { cn } from "@/lib/utils";
import { type ThemePreference, useSettingsStore } from "@/store/settings";
import {
  DARK_SWATCH,
  LIGHT_SWATCH,
  isNamedTheme,
  THEMES,
  type ThemeOption,
  type ThemeSwatchColors,
} from "./themes";

/**
 * The theme choices as small windows drawn in each theme's colors, for
 * Settings and the welcome tour. The named themes start a row of their own.
 */
export function ThemePicker({
  themes = THEMES.map((option) => option.value),
  className,
  columns = "grid-cols-3",
}: {
  /** Which themes to offer. They keep their usual order. */
  themes?: ThemePreference[];
  className?: string;
  /** The grid columns each row of themes is laid out in. */
  columns?: string;
}) {
  const shown = THEMES.filter((option) => themes.includes(option.value));
  const rows = [
    shown.filter((option) => !isNamedTheme(option.value)),
    shown.filter((option) => isNamedTheme(option.value)),
  ].filter((row) => row.length > 0);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn("space-y-3", className)}
    >
      {rows.map((row) => (
        <div key={row[0].value} className={cn("grid gap-3", columns)}>
          {row.map((option) => (
            <ThemeChoice key={option.value} option={option} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ThemeChoice({ option }: { option: ThemeOption }) {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const checked = theme === option.value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={() => setTheme(option.value)}
      className="group space-y-2 text-left outline-none"
    >
      <ThemeSwatch
        swatch={option.swatch}
        className={cn(
          "ring-offset-2 ring-offset-card transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring",
          checked
            ? "ring-2 ring-primary"
            : "ring-1 ring-border group-hover:ring-foreground/30",
        )}
      />
      <span
        className={cn(
          "block text-center text-ui-sm",
          checked ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {option.label}
      </span>
    </button>
  );
}

/** A tiny window drawn in the theme's own colors; none splits light and dark. */
function ThemeSwatch({
  swatch,
  className,
}: {
  swatch?: ThemeSwatchColors;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "relative aspect-[4/3] overflow-hidden rounded-lg",
        className,
      )}
    >
      {swatch ? (
        <Window {...swatch} />
      ) : (
        <>
          <Window {...LIGHT_SWATCH} />
          <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
            <Window {...DARK_SWATCH} />
          </div>
        </>
      )}
    </div>
  );
}

function Window({
  background,
  panel,
  line,
  accent,
}: {
  background: string;
  panel: string;
  line: string;
  accent: string;
}) {
  return (
    <div className="absolute inset-0 flex" style={{ background }}>
      <div className="w-1/4 space-y-1.5 p-2" style={{ background: panel }}>
        <div
          className="h-1 w-3/4 rounded-full"
          style={{ background: accent }}
        />
        <div className="h-1 w-full rounded-full" style={{ background: line }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: line }} />
      </div>
      <div className="flex-1 space-y-1.5 p-3">
        <div
          className="h-1.5 w-1/2 rounded-full"
          style={{ background: line }}
        />
        <div className="h-1 w-full rounded-full" style={{ background: line }} />
        <div className="h-1 w-5/6 rounded-full" style={{ background: line }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: line }} />
      </div>
    </div>
  );
}
