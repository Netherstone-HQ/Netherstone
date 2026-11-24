import "./App.css";
import { useEffect } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { ThemeProvider } from "./components/theme/theme-provider";
import { useVaultInit } from "./hooks/useVaultInit";
import { useForgetGoneVaults } from "./hooks/useForgetGoneVaults";
import { useDismissSplash } from "./hooks/useDismissSplash";
import { useVaultWatcher } from "./hooks/useVaultWatcher";
import { useAutosave } from "./hooks/useAutosave";
import { useVaultIndexing } from "./hooks/useVaultIndexing";
import { useBackgroundSync } from "./hooks/useBackgroundSync";
import { useLocalHistory } from "./hooks/useLocalHistory";
import { useSearchModal } from "./hooks/useSearchModal";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useWhatsNew } from "./hooks/useWhatsNew";
import { SearchModal } from "./components/SearchModal";
import { OutsideChangeDialog } from "@/components/editor/OutsideChangeDialog";
import { OpenLinkDialog } from "@/components/open-link/OpenLinkDialog";
import { NestedVaultDialog } from "@/components/vault/NestedVaultDialog";
import { Toaster } from "@/components/ui/sonner";
import { CompanionHost } from "@/components/brand/CompanionHost";
import { preloadEditorMarkdownWorker } from "@/lib/editor-markdown-worker";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { useWelcomeTour } from "@/components/onboarding/useWelcomeTour";
import { IS_PHONE } from "@/components/phone/phone-shell";
import { PhoneApp } from "@/components/phone/PhoneApp";

function App() {
  useVaultInit();
  useForgetGoneVaults();
  useDismissSplash();
  useVaultWatcher();
  useAutosave();
  useVaultIndexing();
  useLocalHistory();
  useBackgroundSync();
  const { isOpen, setIsOpen } = useSearchModal();
  const { screen, finish, close } = useWelcomeTour();
  useUpdateCheck(screen !== "onboarding");
  useWhatsNew();

  // Start the markdown worker early so the first opened note doesn't wait for it.
  useEffect(() => {
    preloadEditorMarkdownWorker();
  }, []);

  return (
    <ThemeProvider>
      <DndProvider backend={HTML5Backend}>
        <TooltipProvider>
          {screen === "onboarding" ? (
            <Onboarding onDone={finish} onClose={close} />
          ) : IS_PHONE ? (
            <PhoneApp />
          ) : screen === "app-after-onboarding" ? (
            <div className="flex h-full w-full animate-in fade-in duration-300">
              <AppLayout />
            </div>
          ) : (
            <AppLayout />
          )}
          <SearchModal
            open={isOpen && screen !== "onboarding"}
            onOpenChange={setIsOpen}
          />
          <OutsideChangeDialog />
          <NestedVaultDialog />
          <OpenLinkDialog />
          <CompanionHost />
          <Toaster {...(IS_PHONE ? PHONE_TOASTS : {})} />
        </TooltipProvider>
      </DndProvider>
    </ThemeProvider>
  );
}

/**
 * On a phone, toasts sit above the bottom bar (the capture bar is the
 * tallest) and the system's gesture or button bar, as on the canvas.
 */
const PHONE_BOTTOM_BAR_PX = 80;
const PHONE_TOAST_GAP_PX = 8;
const PHONE_TOAST_BOTTOM = `calc(var(--safe-area-bottom, env(safe-area-inset-bottom)) + ${PHONE_BOTTOM_BAR_PX + PHONE_TOAST_GAP_PX}px)`;
const PHONE_TOASTS = {
  offset: { bottom: PHONE_TOAST_BOTTOM },
  mobileOffset: { bottom: PHONE_TOAST_BOTTOM },
};

export default App;
