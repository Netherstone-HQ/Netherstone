import { ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUIStore, type LeftSidebarSection } from "@/store/ui";

const LABEL_CLASS =
  "flex h-full min-w-0 items-center gap-1 rounded-sm px-1.5 text-ui-sm text-muted-foreground";

/**
 * A left sidebar section's label. With `section`, clicking it collapses or
 * expands the section, and the choice is remembered.
 */
export function SectionHeader({
  label,
  section,
  children,
  ...props
}: {
  label: string;
  section?: LeftSidebarSection;
  /** Controls at the right end, such as Files' + menu. */
  children?: React.ReactNode;
} & Omit<React.ComponentProps<"button">, "children">) {
  const isCollapsed = useUIStore((s) =>
    section ? s.collapsedSections[section] : false,
  );
  const toggleSection = useUIStore((s) => s.toggleSection);

  return (
    <div className="flex h-row shrink-0 items-center gap-1">
      {section ? (
        <button
          type="button"
          aria-expanded={!isCollapsed}
          onClick={() => toggleSection(section)}
          {...props}
          className={cn(
            LABEL_CLASS,
            "outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
          )}
        >
          <ChevronRightIcon
            className={cn(
              "size-3.5 transition-transform duration-150",
              !isCollapsed && "rotate-90",
            )}
          />
          {label}
        </button>
      ) : (
        <span className={LABEL_CLASS}>{label}</span>
      )}
      <div className="ml-auto flex items-center">{children}</div>
    </div>
  );
}
