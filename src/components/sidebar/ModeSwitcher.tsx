import { Fragment } from "react";
import { NotebookIcon, SettingsIcon, TagIcon } from "lucide-react";
import { DrawingIcon } from "@/components/icons";
import { Hint } from "@/components/ui/tooltip";
import { selectRailMode, useUIStore, type RailMode } from "@/store/ui";
import { cn } from "@/lib/utils";

const MODES: { mode: RailMode; label: string; icon: React.ElementType }[] = [
  { mode: "editor", label: "Editor", icon: NotebookIcon },
  { mode: "tags", label: "Tags", icon: TagIcon },
  { mode: "canvas", label: "Canvas", icon: DrawingIcon },
];

function RailButton({
  label,
  isActive,
  onClick,
  className,
  children,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} side="right">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex size-10 items-center justify-center rounded-md transition-colors [&_svg]:size-5",
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          className,
        )}
        aria-label={label}
        aria-pressed={isActive}
      >
        {children}
      </button>
    </Hint>
  );
}

export function ModeSwitcher() {
  const railMode = useUIStore(selectRailMode);
  const openMode = useUIStore((s) => s.openMode);
  const activeNavItem = useUIStore((s) => s.activeNavItem);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);

  return (
    <div className="flex h-full w-12 shrink-0 flex-col items-center gap-1.5 border-r bg-sidebar pb-2.5 pt-1">
      {MODES.map(({ mode, label, icon: Icon }) => (
        <Fragment key={mode}>
          {/* A divider sets Canvas apart from the modes for shards. */}
          {mode === "canvas" ? (
            <div aria-hidden="true" className="my-0.5 h-px w-5 bg-input" />
          ) : null}
          <RailButton
            label={label}
            isActive={railMode === mode}
            onClick={() => openMode(mode)}
          >
            <Icon />
          </RailButton>
        </Fragment>
      ))}

      <RailButton
        label="Settings"
        isActive={activeNavItem === "settings"}
        onClick={() =>
          setActiveNavItem(activeNavItem === "settings" ? null : "settings")
        }
        className="mt-auto"
      >
        <SettingsIcon />
      </RailButton>
    </div>
  );
}
