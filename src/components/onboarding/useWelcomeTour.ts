import { useEffect, useRef, useState } from "react";

import { flushPendingAutosave } from "@/hooks/useAutosave";
import { useUIStore } from "@/store";
import { useSettingsStore } from "@/store/settings";

export type Screen = "onboarding" | "app" | "app-after-onboarding";

/**
 * Which screen the window shows: the welcome tour until it has been finished
 * once, and again as soon as "Show welcome again" in Settings clears it.
 * A tour started from Settings can be closed, which puts back the previous
 * finish time.
 */
export function useWelcomeTour() {
  const completedAt = useSettingsStore((s) => s.onboardingCompletedAt);
  const [screen, setScreen] = useState<Screen>(() =>
    completedAt === null ? "onboarding" : "app",
  );
  // The finish time to put back if a replayed tour is closed. Null on a
  // first run, which can't be closed.
  const [restoreTo, setRestoreTo] = useState<string | null>(null);
  const lastCompletedAt = useRef(completedAt);

  useEffect(() => {
    if (completedAt !== null) {
      lastCompletedAt.current = completedAt;
      return;
    }
    if (screen === "onboarding") return;

    let cancelled = false;
    setRestoreTo(lastCompletedAt.current);
    useUIStore.getState().setActiveNavItem(null);
    // Save the open shard before the editor goes away.
    void flushPendingAutosave()
      .catch(() => {})
      .then(() => {
        if (!cancelled) setScreen("onboarding");
      });
    return () => {
      cancelled = true;
    };
  }, [completedAt, screen]);

  function finish() {
    setRestoreTo(null);
    setScreen("app-after-onboarding");
  }

  const close =
    restoreTo === null
      ? undefined
      : () => {
          useSettingsStore.setState({ onboardingCompletedAt: restoreTo });
          setRestoreTo(null);
          setScreen("app-after-onboarding");
        };

  return { screen, finish, close };
}
