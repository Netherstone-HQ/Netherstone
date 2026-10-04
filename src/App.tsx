import "./App.css";
import { useEffect } from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppLayout } from "@/components/AppLayout";
import { ThemeProvider } from "./components/theme/theme-provider";
import { useVaultInit } from "./hooks/useVaultInit";
import { useDismissSplash } from "./hooks/useDismissSplash";
import { useVaultWatcher } from "./hooks/useVaultWatcher";
import { useAutosave } from "./hooks/useAutosave";
import { useVaultIndexing } from "./hooks/useVaultIndexing";
import { useBackgroundSync } from "./hooks/useBackgroundSync";
import { useSearchModal } from "./hooks/useSearchModal";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { SearchModal } from "./components/SearchModal";
import { Toaster } from "@/components/ui/sonner";
import { preloadEditorMarkdownWorker } from "@/lib/editor-markdown-worker";
import { Onboarding } from "@/components/onboarding/Onboarding";
import { useWelcomeTour } from "@/components/onboarding/useWelcomeTour";

function App() {
  useVaultInit();
  useDismissSplash();
  useVaultWatcher();
  useAutosave();
  useVaultIndexing();
  useBackgroundSync();
  const { isOpen, setIsOpen } = useSearchModal();
  const { screen, finish, close } = useWelcomeTour();
  useUpdateCheck(screen !== "onboarding");

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
          <Toaster />
        </TooltipProvider>
      </DndProvider>
    </ThemeProvider>
  );
}

export default App;
