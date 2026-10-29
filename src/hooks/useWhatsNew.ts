import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { whenSplashLeaves } from "@/lib/splash";
import { isInstalledApp } from "@/lib/updates";
import { useUIStore } from "@/store";
import { useSettingsStore } from "@/store/settings";

/** The website's changelog page for this version. */
export function changelogUrl(version: string) {
  return `https://netherstone.app/changelog/v${version}?ref=app`;
}

/** Says the app was updated, with a link to what changed. */
export function showWhatsNewToast(version: string) {
  toast(`Updated to Netherstone ${version}`, {
    id: "whats-new",
    duration: 15_000,
    action: {
      label: "What's new",
      onClick: () => {
        // The browser panel lives beside the editor.
        const ui = useUIStore.getState();
        ui.setAppMode("notes");
        ui.openInBrowserPanel(changelogUrl(version));
      },
    },
  });
}

/**
 * Once per launch, notes the version the app runs as. The first launch on a
 * new version says so, unless it's the very first launch: a fresh install
 * shows the welcome tour instead.
 */
export function useWhatsNew() {
  const checked = useRef(false);

  useEffect(() => {
    if (checked.current || !isInstalledApp()) return;
    checked.current = true;

    const version = __APP_VERSION__;
    const { lastSeenVersion, onboardingCompletedAt } =
      useSettingsStore.getState();
    if (lastSeenVersion === version) return;

    useSettingsStore.setState({ lastSeenVersion: version });
    if (onboardingCompletedAt === null) return;
    void whenSplashLeaves().then(() => showWhatsNewToast(version));
  }, []);
}
