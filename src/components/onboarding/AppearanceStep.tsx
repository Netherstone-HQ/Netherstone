import { CheckCircleIcon } from "@phosphor-icons/react";

import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/store/settings";
import { copy } from "./copy";
import { Step } from "./StepLayout";

// Onboarding offers the basics; the named themes live in Settings.
const THEMES = ["light", "dark", "system"] as const satisfies ThemePreference[];

// Basalt surfaces, fixed so each preview shows its own theme whatever the
// app is currently in.
const SURFACES = {
  light: { page: "#F6F5F2", side: "#ECEAE5", line: "#C9C6BF", accent: "#2B6A5B" },
  dark: { page: "#141516", side: "#1C1D1F", line: "#3A3C3E", accent: "#4FA38E" },
};

export function AppearanceStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <Step
      title={copy.appearance.title}
      body={copy.appearance.body}
      onBack={onBack}
      action={<Button onClick={onNext}>{copy.common.continue}</Button>}
    >
      <div className="grid grid-cols-3 gap-3" role="radiogroup">
        {THEMES.map((option) => {
          const selected = theme === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(option)}
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
                {option === "system" ? (
                  <div className="relative">
                    <Preview tone="light" />
                    <div className="absolute inset-0 [clip-path:polygon(100%_0,100%_100%,0_100%)]">
                      <Preview tone="dark" />
                    </div>
                  </div>
                ) : (
                  <Preview tone={option} />
                )}
              </div>
              <span className="flex items-center gap-1.5 font-medium text-sm">
                {copy.appearance.options[option]}
                {selected ? (
                  <CheckCircleIcon weight="fill" className="size-4" />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </Step>
  );
}

/** A tiny sketch of the app: sidebar, a heading and a few lines of text. */
function Preview({ tone }: { tone: "light" | "dark" }) {
  const c = SURFACES[tone];
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
