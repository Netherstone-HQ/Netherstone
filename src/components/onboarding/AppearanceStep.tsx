import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { isNamedTheme } from "@/components/theme/themes";
import { useTheme } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/store/settings";
import { copy } from "./copy";
import { Step } from "./StepLayout";

// The basics up front; the named themes wait behind "More themes".
const BASIC_THEMES: ThemePreference[] = ["light", "dark", "system"];

export function AppearanceStep({
  onBack,
  onNext,
}: {
  onBack: () => void;
  onNext: () => void;
}) {
  const { theme } = useTheme();
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
        <ThemePicker themes={showMore ? undefined : BASIC_THEMES} />
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showMore}
          onClick={() => setShowMore((open) => !open)}
          className="-ml-2.5 text-muted-foreground text-ui-sm"
        >
          {showMore ? copy.appearance.fewerThemes : copy.appearance.moreThemes}
          <ChevronDownIcon
            data-icon="inline-end"
            className={cn("size-3 transition-transform", showMore && "rotate-180")}
          />
        </Button>
      </div>
    </Step>
  );
}
