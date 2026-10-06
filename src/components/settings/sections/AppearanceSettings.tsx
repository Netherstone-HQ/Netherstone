import {
  type Option,
  PreferenceSegments,
  PreferenceSelect,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import { cn } from "@/lib/utils";
import {
  type ContentWidth,
  type ReadingFont,
  type TextSize,
  type ThemePreference,
  useSettingsStore,
} from "@/store/settings";

const THEMES: { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

const FONTS: Option<ReadingFont>[] = [
  {
    value: "newsreader",
    label: "Newsreader",
    className: "[font-family:'Newsreader_Variable',serif]",
  },
  { value: "geist", label: "Geist", className: "font-sans" },
  {
    value: "system",
    label: "System font",
    className: "[font-family:system-ui]",
  },
];

const SIZES: Option<TextSize>[] = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
];

const WIDTHS: Option<ContentWidth>[] = [
  { value: "narrow", label: "Narrow" },
  { value: "default", label: "Default" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

export function AppearanceSettings() {
  return (
    <>
      <SettingsGroup title="Theme">
        <ThemePicker />
      </SettingsGroup>

      <SettingsGroup
        title="Reading"
        description="How shards look while you read and write."
      >
        <ReadingPreview />
        <PreferenceSelect
          name="readingFont"
          label="Shard font"
          options={FONTS}
        />
        <PreferenceSegments name="textSize" label="Text size" options={SIZES} />
        <PreferenceSegments
          name="contentWidth"
          label="Line width"
          description="How wide the text column gets in a large window."
          options={WIDTHS}
        />
      </SettingsGroup>
    </>
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
              value={option.value}
              className={cn(
                "ring-offset-2 ring-offset-card transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring",
                checked
                  ? "ring-2 ring-primary"
                  : "ring-1 ring-border group-hover:ring-foreground/30",
              )}
            />
            <span
              className={cn(
                "block text-center text-xs",
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

/** A tiny window drawn in the theme's own colors. */
function ThemeSwatch({
  value,
  className,
}: {
  value: ThemePreference;
  className?: string;
}) {
  const light = (
    <Window
      background="#f6f5f2"
      panel="#eeebe5"
      line="#d6d2ca"
      accent="#2b6a5b"
    />
  );
  const dark = (
    <Window
      background="#141516"
      panel="#1c1d1f"
      line="#34363a"
      accent="#4fa38e"
    />
  );

  return (
    <div
      className={cn(
        "relative aspect-[4/3] overflow-hidden rounded-lg",
        className,
      )}
    >
      {value === "light" ? light : null}
      {value === "dark" ? dark : null}
      {value === "system" ? (
        <>
          {light}
          <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
            {dark}
          </div>
        </>
      ) : null}
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

/** Sample text in the chosen reading font and size. */
function ReadingPreview() {
  return (
    <div className="px-4 py-5">
      <p className="font-reading text-(length:--reading-size) leading-relaxed">
        <span className="font-semibold">Your knowledge, set in stone.</span>{" "}
        A shard is a Markdown document on your computer, and your vault is
        the folder that holds them. A drawing is a sketch or diagram you can
        place in any shard. Sync keeps your vault the same on every device.
      </p>
    </div>
  );
}
