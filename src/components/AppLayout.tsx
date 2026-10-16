import * as React from "react";
import { useCallback, useState } from "react";
import { useAppShortcuts } from "@/hooks/useAppShortcuts";
import { useUIStore } from "@/store";

import { RightSidebar } from "./sidebar/RightSidebar";
import { LeftSidebar } from "./sidebar/LeftSidebar";
import { TagsView } from "./tags/TagsView";
import { SettingsPage } from "./settings/SettingsPage";
import { ExportDialogHost } from "./export/ExportDialogHost";
import { NewShardDialog } from "./vault/NewShardDialog";
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

const MemoizedLeftSidebar = React.memo(LeftSidebar);

// Mounted the first time canvas mode opens, then kept so a drawing keeps its
// view and undo history while notes are shown.
const ModeAwareCanvas = React.memo(function ModeAwareCanvas() {
  const appMode = useUIStore((s) => s.appMode);
  const [hasOpened, setHasOpened] = useState(appMode === "canvas");
  if (appMode === "canvas" && !hasOpened) setHasOpened(true);
  if (!hasOpened) return null;

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

// Mounted only while Tags is open, so its results cost nothing elsewhere.
const ModeAwareTags = React.memo(function ModeAwareTags() {
  const appMode = useUIStore((s) => s.appMode);
  if (appMode !== "tags") return null;

  return (
    <main className="min-h-0 flex-1">
      <TagsView />
    </main>
  );
});

const ModeAwareNotes = React.memo(function ModeAwareNotes({
  children,
}: {
  children?: React.ReactNode;
}) {
  const appMode = useUIStore((s) => s.appMode);
  const isBrowserPanelOpen = useUIStore((s) => s.isBrowserPanelOpen);

  return (
    <div
      className={
        appMode === "notes"
          ? "flex min-h-0 flex-1 flex-col"
          : "hidden min-h-0 flex-1 flex-col"
      }
    >
      <AppHeader />

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
  const [isNewShardDialogOpen, setIsNewShardDialogOpen] = useState(false);
  const openNewShardDialog = useCallback(
    () => setIsNewShardDialogOpen(true),
    [],
  );
  useAppShortcuts({ onNewShard: openNewShardDialog });

  return (
    <SidebarProvider open={isSidebarOpen} onOpenChange={setSidebarOpen}>
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <WindowTitleBar />

        <div className="flex min-h-0 flex-1">
          <ModeSwitcher />

          {/* Settings covers the left sidebar too: its categories take the
              sidebar's place, and the sidebar is back as it was on leaving. */}
          <div className="relative flex min-w-0 flex-1">
            <MemoizedLeftSidebar onNewShard={openNewShardDialog} />

            {/* Its own stacking layer, so the editor's raised parts (block
                handles at z-50) stay under Settings and the sidebar. */}
            <div className="relative isolate flex h-full min-w-0 flex-1 flex-col">
              <ModeAwareCanvas />
              <ModeAwareTags />
              <ModeAwareNotes children={children} />
            </div>

            {children == null && activeNavItem === "settings" && (
              <div className="absolute inset-0 z-31 bg-background">
                <CoversBrowser />
                <SettingsPage />
              </div>
            )}
          </div>

          <NewShardDialog
            open={isNewShardDialogOpen}
            onOpenChange={setIsNewShardDialogOpen}
          />
          <ExportDialogHost />
        </div>
      </div>
    </SidebarProvider>
  );
}
