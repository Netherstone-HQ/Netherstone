import { CaretDownIcon, CheckCircleIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { useTheme } from "@/components/theme/theme-provider";
import {
  isNamedTheme,
  NAMED_THEMES,
  THEMES as ALL_THEMES,
} from "@/components/theme/themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/store/settings";
import { copy } from "./copy";
import { Step } from "./StepLayout";

// The basics up front; the named themes wait behind "More themes".
const THEMES = ["light", "dark", "system"] as const satisfies ThemePreference[];

interface Surfaces {
  page: string;
  side: string;
  line: string;
  accent: string;
}

// Fixed colors, so each preview shows its own theme whatever the app is
// currently in.
const SURFACES: Record<"light" | "dark", Surfaces> = {
  light: { page: "#F6F5F2", side: "#ECEAE5", line: "#C9C6BF", accent: "#2B6A5B" },
  dark: { page: "#141516", side: "#1C1D1F", line: "#3A3C3E", accent: "#4FA38E" },
};

function namedSurfaces(theme: ThemePreference): Surfaces {
  const swatch = ALL_THEMES.find((t) => t.value === theme)?.swatch;
  if (!swatch) return SURFACES.dark;
  return {
    page: swatch.background,
    side: swatch.panel,
    line: swatch.line,
    accent: swatch.accent,
  };
}

export function AppearanceStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const { theme, setTheme } = useTheme();
  // Open already when one of the named themes is picked.
  const [showMore, setShowMore] = useState(() => isNamedTheme(theme));

  return (
    <Step
      title={copy.appearance.title}
      body={copy.appearance.body}
      onBack={onBack}
      action={<Button onClick={onNext}>{copy.common.continue}</Button>}
    >
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3" role="radiogroup">
          {THEMES.map((option) => (
            <ThemeOption
              key={option}
              label={copy.appearance.options[option]}
              selected={theme === option}
              onSelect={() => setTheme(option)}
            >
              {option === "system" ? (
                <div className="relative">
                  <Preview colors={SURFACES.light} />
                  <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                    <Preview colors={SURFACES.dark} />
                  </div>
                </div>
              ) : (
                <Preview colors={SURFACES[option]} />
              )}
            </ThemeOption>
          ))}
          {showMore
            ? NAMED_THEMES.map((option) => (
                <ThemeOption
                  key={option}
                  label={copy.appearance.options[option]}
                  selected={theme === option}
                  onSelect={() => setTheme(option)}
                >
                  <Preview colors={namedSurfaces(option)} />
                </ThemeOption>
              ))
            : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showMore}
          onClick={() => setShowMore((open) => !open)}
          className="-ml-2.5 text-muted-foreground text-xs"
        >
          {showMore ? copy.appearance.fewerThemes : copy.appearance.moreThemes}
          <CaretDownIcon
            data-icon="inline-end"
            className={cn("size-3 transition-transform", showMore && "rotate-180")}
          />
        </Button>
      </div>
    </Step>
  );
}

function ThemeOption({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="group space-y-2 rounded-xl text-left outline-none"
    >
      <div
        className={cn(
          "overflow-hidden rounded-xl border transition-shadow group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
          selected
            ? "border-foreground/40 ring-2 ring-foreground/15"
            : "group-hover:border-foreground/25",
        )}
      >
        {children}
      </div>
      <span className="flex items-center gap-1.5 font-medium text-sm">
        {label}
        {selected ? <CheckCircleIcon weight="fill" className="size-4" /> : null}
      </span>
    </button>
  );
}

/** A tiny sketch of the app: sidebar, a heading and a few lines of text. */
function Preview({ colors: c }: { colors: Surfaces }) {
  return (
    <div className="flex aspect-[4/3]" style={{ background: c.page }}>
      <div className="w-1/4 space-y-1.5 p-2" style={{ background: c.side }}>
        <div className="h-1 w-3/4 rounded-full" style={{ background: c.accent }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-1/2 rounded-full" style={{ background: c.line }} />
      </div>
      <div className="flex-1 space-y-1.5 p-3">
        <div className="h-1.5 w-1/2 rounded-full" style={{ background: c.line }} />
        <div className="h-1 w-full rounded-full" style={{ background: c.line, opacity: 0.6 }} />
        <div className="h-1 w-5/6 rounded-full" style={{ background: c.line, opacity: 0.6 }} />
        <div className="h-1 w-2/3 rounded-full" style={{ background: c.line, opacity: 0.6 }} />
      </div>
    </div>
  );
}
