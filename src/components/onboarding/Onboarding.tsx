import "./onboarding.css";

import { useState } from "react";
import { XIcon } from "@phosphor-icons/react";

import { WindowTitleBar } from "@/components/WindowTitleBar";
import { Button } from "@/components/ui/button";
import { openEditorFile } from "@/lib/open-editor-file";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";
import { useSyncStore } from "@/store/sync";
import { AppearanceStep } from "./AppearanceStep";
import { copy } from "./copy";
import { ReadyStep } from "./ReadyStep";
import { SyncStep } from "./SyncStep";
import { VaultStep, type VaultChoice } from "./VaultStep";
import { addStartHere } from "./start-here";
import { StepProgress } from "./StepLayout";
import { WelcomeStep } from "./WelcomeStep";

type Step = "welcome" | "vault" | "appearance" | "sync" | "ready";

/** How long the flow takes to fade into the app. Matches .onboarding-leave. */
const LEAVE_MS = 220;

/**
 * The first-run welcome: picks or creates a vault, a theme and, optionally,
 * sync, then hands over to the app. Shown until it has been finished once.
 * `onClose` is given when the tour was started again from Settings.
 */
export function Onboarding({
  onDone,
  onClose,
}: {
  onDone: () => void;
  onClose?: () => void;
}) {
  const [step, setStep] = useState<Step>("welcome");
  const [vault, setVault] = useState<VaultChoice | null>(null);
  const [leaving, setLeaving] = useState(false);
  const completeOnboarding = useSettingsStore((s) => s.completeOnboarding);

  const steps: Step[] = ["vault", "appearance", "sync", "ready"];

  function next() {
    const index = steps.indexOf(step as Exclude<Step, "welcome">);
    setStep(step === "welcome" ? steps[0] : steps[index + 1]);
  }

  function back() {
    const index = steps.indexOf(step as Exclude<Step, "welcome">);
    setStep(index <= 0 ? "welcome" : steps[index - 1]);
  }

  async function chooseVault(choice: VaultChoice) {
    const sync = useSyncStore.getState();
    if (sync.vaultPath !== choice.path) await sync.load(choice.path);
    setVault(choice);
    setStep("appearance");
  }

  async function finish(addGuide: boolean) {
    completeOnboarding();
    try {
      const guide =
        vault?.startHerePath ??
        (vault && addGuide ? await addStartHere(vault.path) : null);
      if (guide) await openEditorFile(guide);
    } catch (error) {
      console.error("[Netherstone] Couldn't open Start here:", error);
    }
    setLeaving(true);
    window.setTimeout(onDone, LEAVE_MS);
  }

  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col bg-background text-foreground",
        leaving && "onboarding-leave",
      )}
    >
      <div className="absolute inset-x-0 top-0 z-10">
        <WindowTitleBar bare />
      </div>
      {onClose ? (
        <Button
          variant="ghost"
          size="icon-sm"
          className="tauri-no-drag absolute top-1.5 left-2 z-20 text-muted-foreground"
          aria-label={copy.common.close}
          title={copy.common.close}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      ) : null}

      {step === "welcome" ? (
        <WelcomeStep onStart={next} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col pt-9">
          <StepProgress.Provider
            value={{
              index: steps.indexOf(step),
              total: steps.length,
            }}
          >
            {step === "vault" ? (
              <VaultStep onBack={back} onChoose={(choice) => void chooseVault(choice)} />
            ) : step === "appearance" ? (
              <AppearanceStep onBack={back} onNext={next} />
            ) : step === "sync" && vault ? (
              <SyncStep vaultPath={vault.path} onBack={back} onNext={next} />
            ) : vault ? (
              <ReadyStep vault={vault} onBack={back} onFinish={(addGuide) => void finish(addGuide)} />
            ) : null}
          </StepProgress.Provider>
        </div>
      )}
    </div>
  );
}

