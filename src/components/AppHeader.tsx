import { GlobeIcon, SidebarIcon } from "@phosphor-icons/react";
import { FilePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AutosaveIndicator } from "./editor/AutosaveIndicator";
import { WordCount } from "./editor/WordCount";
import { VaultTitle } from "./vault/VaultTitle";

interface AppHeaderProps {
  isBrowserPanelOpen: boolean;
  isRightSidebarOpen: boolean;
  onToggleBrowserPanel: () => void;
  onToggleRightSidebar: () => void;
  onNewShard: () => void;
}

export function AppHeader({
  isBrowserPanelOpen,
  isRightSidebarOpen,
  onToggleBrowserPanel,
  onToggleRightSidebar,
  onNewShard,
}: AppHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-stretch border-b">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-4" />
        <VaultTitle />
        <AutosaveIndicator />
        <WordCount />
        <div className="ml-auto flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggleBrowserPanel}
            aria-label={
              isBrowserPanelOpen ? "Hide browser panel" : "Show browser panel"
            }
            aria-pressed={isBrowserPanelOpen}
            title={
              isBrowserPanelOpen ? "Hide browser panel" : "Show browser panel"
            }
          >
            <GlobeIcon className="size-5" />
          </Button>
          <Separator orientation="vertical" className="h-4" />
          <Button
            type="button"
            data-sidebar="trigger"
            data-slot="sidebar-trigger"
            variant="ghost"
            onClick={onToggleRightSidebar}
            aria-label={
              isRightSidebarOpen ? "Hide right sidebar" : "Show right sidebar"
            }
            aria-expanded={isRightSidebarOpen}
            title={
              isRightSidebarOpen ? "Hide right sidebar" : "Show right sidebar"
            }
          >
            <SidebarIcon className="size-5 scale-x-[-1]" />
            <span className="sr-only">Toggle Right Sidebar</span>
          </Button>
        </div>
      </div>

      <div className="flex w-72 shrink-0 items-center gap-2 border-l pl-4 pr-2">

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onNewShard}
          className="ml-auto gap-2 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        >
          <FilePlusIcon className="size-4" />
          New Shard
        </Button>
      </div>
    </header>
  );
}
