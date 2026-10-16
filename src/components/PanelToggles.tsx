import { GlobeIcon, PanelLeftIcon, PanelRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { useUIStore } from "@/store";

function PanelToggle({
  label,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onToggle}
        aria-label={label}
        aria-expanded={isOpen}
        className="text-muted-foreground hover:text-foreground"
      >
        {children}
      </Button>
    </Hint>
  );
}

export function LeftSidebarToggle() {
  const isOpen = useUIStore((s) => s.isSidebarOpen);
  const toggle = useUIStore((s) => s.toggleSidebar);

  return (
    <PanelToggle
      label={isOpen ? "Hide left sidebar" : "Show left sidebar"}
      isOpen={isOpen}
      onToggle={toggle}
    >
      <PanelLeftIcon />
    </PanelToggle>
  );
}

export function RightSidebarToggle() {
  const isOpen = useUIStore((s) => s.isRightSidebarOpen);
  const toggle = useUIStore((s) => s.toggleRightSidebar);

  return (
    <PanelToggle
      label={isOpen ? "Hide right sidebar" : "Show right sidebar"}
      isOpen={isOpen}
      onToggle={toggle}
    >
      <PanelRightIcon />
    </PanelToggle>
  );
}

/** The Editor's browser panel, or Canvas's own with `isCanvas`. */
export function BrowserPanelToggle({
  isCanvas = false,
}: {
  isCanvas?: boolean;
}) {
  const isOpen = useUIStore((s) =>
    isCanvas ? s.isCanvasBrowserPanelOpen : s.isBrowserPanelOpen,
  );
  const toggle = useUIStore((s) =>
    isCanvas ? s.toggleCanvasBrowserPanel : s.toggleBrowserPanel,
  );

  return (
    <PanelToggle
      label={isOpen ? "Hide browser panel" : "Show browser panel"}
      isOpen={isOpen}
      onToggle={toggle}
    >
      <GlobeIcon />
    </PanelToggle>
  );
}
