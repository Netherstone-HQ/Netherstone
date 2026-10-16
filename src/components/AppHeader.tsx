import { FilePlusIcon, GlobeIcon, PanelLeftIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Hint } from "@/components/ui/tooltip";
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
  const browserPanelLabel = isBrowserPanelOpen
    ? "Hide browser panel"
    : "Show browser panel";
  const rightSidebarLabel = isRightSidebarOpen
    ? "Hide right sidebar"
    : "Show right sidebar";

  return (
    <header className="flex h-12 shrink-0 items-stretch border-b">
      <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="h-4" />
        <VaultTitle />
        <AutosaveIndicator />
        <WordCount />
        <div className="ml-auto flex items-center gap-2">
          <Hint label={browserPanelLabel} side="bottom">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleBrowserPanel}
              aria-label={browserPanelLabel}
              aria-pressed={isBrowserPanelOpen}
            >
              <GlobeIcon />
            </Button>
          </Hint>
          <Separator orientation="vertical" className="h-4" />
          <Hint label={rightSidebarLabel} side="bottom">
            <Button
              type="button"
              data-sidebar="trigger"
              data-slot="sidebar-trigger"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleRightSidebar}
              aria-label={rightSidebarLabel}
              aria-expanded={isRightSidebarOpen}
            >
              <PanelLeftIcon className="scale-x-[-1]" />
            </Button>
          </Hint>
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
          <FilePlusIcon />
          New shard
        </Button>
      </div>
    </header>
  );
}
