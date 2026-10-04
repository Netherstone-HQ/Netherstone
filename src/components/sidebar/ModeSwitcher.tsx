import { GearIcon, NotebookIcon, ScribbleIcon } from "@phosphor-icons/react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useUIStore } from "@/store/ui";
import type { AppMode } from "@/store/ui";
import { cn } from "@/lib/utils";

const modes: { mode: AppMode; label: string; icon: React.ElementType }[] = [
  { mode: "notes", label: "Notes", icon: NotebookIcon },
  { mode: "canvas", label: "Canvas", icon: ScribbleIcon },
];

export function ModeSwitcher() {
  const appMode = useUIStore((s) => s.appMode);
  const setAppMode = useUIStore((s) => s.setAppMode);
  const activeNavItem = useUIStore((s) => s.activeNavItem);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);

  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1.5 border-r bg-sidebar pb-2.5 pt-1">
      {modes.map(({ mode, label, icon: Icon }) => (
        <Tooltip key={mode} delayDuration={300}>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setAppMode(mode)}
              className={cn(
                "flex size-10 items-center justify-center rounded-md transition-colors",
                appMode === mode
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
              aria-label={label}
              aria-pressed={appMode === mode}
            >
              <Icon className="size-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={6}>
            {label}
          </TooltipContent>
        </Tooltip>
      ))}

      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() =>
              setActiveNavItem(activeNavItem === "settings" ? null : "settings")
            }
            className={cn(
              "mt-auto flex size-10 items-center justify-center rounded-md transition-colors",
              activeNavItem === "settings"
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
            )}
            aria-label="Settings"
            aria-pressed={activeNavItem === "settings"}
          >
            <GearIcon className="size-5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" sideOffset={6}>
          Settings
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
