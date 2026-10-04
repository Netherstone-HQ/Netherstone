import * as React from "react";
import { useState } from "react";
import { useUIStore } from "@/store";

import { RightSidebar } from "./sidebar/RightSidebar";
import { LeftSidebar } from "./sidebar/LeftSidebar";
import { TagBrowser } from "./tags/TagBrowser";
import { SettingsPage } from "./settings/SettingsPage";
import { NewShardDialog } from "./vault/NewShardDialog";
import { XIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { SidebarProvider } from "@/components/ui/sidebar";
import { BrowserPanel } from "./browser/BrowserPanel";
import { useCoversBrowser } from "./browser/browserOcclusion";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { AppHeader } from "./AppHeader";
import { Editor } from "./editor/Editor";
import { ModeSwitcher } from "./sidebar/ModeSwitcher";
import { ExcalidrawView } from "./ExcalidrawView";
import { WindowTitleBar } from "./WindowTitleBar";

interface AppLayoutProps {
  children?: React.ReactNode;
}

const MainEditorContent = React.memo(function MainEditorContent() {
  return <Editor />;
});

const ModeAwareLeftSidebar = React.memo(function ModeAwareLeftSidebar({
  onNewShard,
}: {
  onNewShard: () => void;
}) {
  const appMode = useUIStore((s) => s.appMode);

  return (
    <div className={appMode === "notes" ? "" : "hidden"}>
      <LeftSidebar onNewShard={onNewShard} />
    </div>
  );
});

const ModeAwareCanvas = React.memo(function ModeAwareCanvas() {
  const appMode = useUIStore((s) => s.appMode);

  return (
    <main
      className={
        appMode === "canvas" ? "min-h-0 flex-1" : "hidden min-h-0 flex-1"
      }
    >
      <ExcalidrawView />
    </main>
  );
});

const ModeAwareNotes = React.memo(function ModeAwareNotes({
  children,
  isBrowserPanelOpen,
  setBrowserPanelOpen,
  isRightSidebarOpen,
  toggleRightSidebar,
  activeNavItem,
  setActiveNavItem,
  onNewShard,
}: {
  children?: React.ReactNode;
  isBrowserPanelOpen: boolean;
  setBrowserPanelOpen: (open: boolean) => void;
  isRightSidebarOpen: boolean;
  toggleRightSidebar: () => void;
  activeNavItem: "notes" | "search" | "tags" | "settings" | null;
  setActiveNavItem: (
    item: "notes" | "search" | "tags" | "settings" | null,
  ) => void;
  onNewShard: () => void;
}) {
  const appMode = useUIStore((s) => s.appMode);

  return (
    <div
      className={
        appMode === "notes"
          ? "flex min-h-0 flex-1 flex-col"
          : "hidden min-h-0 flex-1 flex-col"
      }
    >
      <AppHeader
        isBrowserPanelOpen={isBrowserPanelOpen}
        isRightSidebarOpen={isRightSidebarOpen}
        onToggleBrowserPanel={() => {
          if (isBrowserPanelOpen) {
            setBrowserPanelOpen(false);
            return;
          }

          setBrowserPanelOpen(true);
        }}
        onToggleRightSidebar={toggleRightSidebar}
        onNewShard={onNewShard}
      />

      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          defaultSize={isBrowserPanelOpen ? "68%" : "100%"}
          minSize="40%"
        >
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <div className="relative flex min-h-0 flex-1">
              <main className="flex min-w-0 flex-1 flex-col overflow-auto">
                {children ?? <MainEditorContent />}
              </main>

              <RightSidebar />

              {children == null && activeNavItem === "tags" && (
                <div className="absolute inset-0 z-31 bg-background">
                  <TagBrowser />
                </div>
              )}
            </div>
          </div>
        </ResizablePanel>

        {isBrowserPanelOpen && (
          <>
            <ResizableHandle
              withHandle
              className="group relative z-31 -mx-1 w-2 bg-transparent after:left-1/2 after:w-3 after:-translate-x-1/2 hover:bg-border/30 data-[resize-handle-state=drag]:bg-border/40 [&>div]:h-10 [&>div]:w-1.5 [&>div]:rounded-full [&>div]:bg-border/80 group-hover:[&>div]:bg-border"
            />
            <ResizablePanel defaultSize="32%" minSize="22%" maxSize="60%">
              <BrowserPanel />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </div>
  );
});

/** Settings is drawn over the browser panel, so the native view steps aside. */
function CoversBrowser() {
  useCoversBrowser();
  return null;
}

export function AppLayout({ children }: AppLayoutProps) {
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const activeNavItem = useUIStore((s) => s.activeNavItem);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);
  const isRightSidebarOpen = useUIStore((s) => s.isRightSidebarOpen);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);
  const isBrowserPanelOpen = useUIStore((s) => s.isBrowserPanelOpen);
  const setBrowserPanelOpen = useUIStore((s) => s.setBrowserPanelOpen);
  const [isNewShardDialogOpen, setIsNewShardDialogOpen] = useState(false);

  return (
    <SidebarProvider open={isSidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <WindowTitleBar />

        <div className="flex min-h-0 flex-1">
          <ModeSwitcher />
          <ModeAwareLeftSidebar
            onNewShard={() => setIsNewShardDialogOpen(true)}
          />

          <div className="relative flex h-full min-w-0 flex-1 flex-col">
            <ModeAwareCanvas />
            <ModeAwareNotes
              children={children}
              isBrowserPanelOpen={isBrowserPanelOpen}
              setBrowserPanelOpen={setBrowserPanelOpen}
              isRightSidebarOpen={isRightSidebarOpen}
              toggleRightSidebar={toggleRightSidebar}
              activeNavItem={activeNavItem}
              setActiveNavItem={setActiveNavItem}
              onNewShard={() => setIsNewShardDialogOpen(true)}
            />

            {children == null && activeNavItem === "settings" && (
              <div className="absolute inset-0 z-31 bg-background">
                <CoversBrowser />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setActiveNavItem(null)}
                  className="absolute top-4 right-4 z-10 text-muted-foreground hover:text-accent-foreground"
                  aria-label="Close settings"
                >
                  <XIcon className="size-4" />
                </Button>
                <SettingsPage />
              </div>
            )}
          </div>

          <NewShardDialog
            open={isNewShardDialogOpen}
            onOpenChange={setIsNewShardDialogOpen}
          />
        </div>
      </div>
    </SidebarProvider>
  );
}
