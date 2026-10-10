import type { ReactNode } from "react";
import { CaretRightIcon } from "@phosphor-icons/react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { type RightSidebarSection, useUIStore } from "@/store/ui";

/** A right sidebar section whose header expands and collapses it. */
export function CollapsibleSection({
  section,
  title,
  icon,
  adornment,
  className,
  children,
}: {
  section: RightSidebarSection;
  title: string;
  icon?: ReactNode;
  /** Shown after the title, like a count or an unsaved dot. */
  adornment?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const open = useUIStore((s) => s.rightSidebarSections[section]);
  const setOpen = useUIStore((s) => s.setRightSidebarSectionOpen);

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setOpen(section, next)}
      className={className}
    >
      <h3>
        <CollapsibleTrigger className="-mx-1.5 flex w-[calc(100%+0.75rem)] items-center gap-2 rounded-md px-1.5 py-1 text-left font-semibold text-sm outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring/50">
          {icon}
          <span>{title}</span>
          {adornment}
          <CaretRightIcon
            aria-hidden="true"
            className={cn(
              "ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform duration-150",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
