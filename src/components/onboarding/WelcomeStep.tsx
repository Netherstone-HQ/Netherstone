import { useEffect, useState } from "react";

import { NetherstoneMark } from "@/components/brand/NetherstoneMark";
import { NetherstoneWordmark } from "@/components/brand/NetherstoneWordmark";
import { Button } from "@/components/ui/button";
import { whenSplashLeaves } from "@/lib/splash";
import { copy } from "./copy";

/**
 * The lockup sits exactly where the splash leaves it, at the same size, so
 * the splash fades out around it and the welcome rises in below.
 */
export function WelcomeStep({ onStart }: { onStart: () => void }) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void whenSplashLeaves().then(() => {
      if (!cancelled) setRevealed(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative flex-1">
      <div className="absolute inset-0 grid place-items-center">
        <div className="flex items-center gap-3">
          <NetherstoneMark className="size-11" />
          <NetherstoneWordmark className="h-[20.22px] w-auto text-foreground" />
        </div>
      </div>

      {revealed ? (
        <div className="onboarding-rise absolute inset-x-0 top-[calc(50%+2.5rem)] flex flex-col items-center gap-8 px-6 text-center">
          <p className="text-lg text-muted-foreground tracking-tight">
            {copy.welcome.tagline}
          </p>
          <Button size="lg" className="min-w-40" onClick={onStart}>
            {copy.welcome.start}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
