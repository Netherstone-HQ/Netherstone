import {
  SettingRow,
  Stepper,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import {
  DARK_SWATCH,
  LIGHT_SWATCH,
  THEMES,
  type ThemeSwatchColors,
} from "@/components/theme/themes";
import { cn } from "@/lib/utils";
import {
  stepZoom,
  useSettingsStore,
  type Zoom,
  ZOOM_LEVELS,
} from "@/store/settings";

export function AppearanceSettings() {
  return (
    <>
      <SettingsGroup title="Theme">
        <ThemePicker />
      </SettingsGroup>

      <SettingsGroup>
        <ZoomRow />
      </SettingsGroup>
    </>
  );
}

function ZoomRow() {
  const zoom = useSettingsStore((s) => s.zoom);
  const setPreference = useSettingsStore((s) => s.setPreference);

  return (
    <SettingRow
      label="Zoom"
      description="Makes everything in Netherstone bigger or smaller."
    >
      <Stepper
        label="Zoom"
        value={zoom}
        min={ZOOM_LEVELS[0]}
        max={ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
        step={(value, direction) => stepZoom(value as Zoom, direction)}
        format={(value) => `${value}%`}
        decreaseLabel="Zoom out"
        increaseLabel="Zoom in"
        onChange={(next) => setPreference("zoom", next as Zoom)}
      />
    </SettingRow>
  );
}

function ThemePicker() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="grid grid-cols-3 gap-3 p-4"
    >
      {THEMES.map((option) => {
        const checked = theme === option.value;
        return (
          <button
            key={option.value}
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
                checked
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
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
