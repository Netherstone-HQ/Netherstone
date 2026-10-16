import type { ReactNode } from "react";

import { SectionHeader } from "@/components/sidebar/SectionHeader";
import { type SidebarSection, useUIStore } from "@/store/ui";

/** Right sidebar text that stands in for a section's content. */
export const SECTION_NOTE_CLASS =
  "px-1.5 py-1 text-ui-sm text-muted-foreground";

/** A right sidebar section whose header collapses it, as on the left. */
export function CollapsibleSection({
  section,
  label,
  count,
  children,
}: {
  section: SidebarSection;
  label: string;
  count?: number;
  children: ReactNode;
}) {
  const isCollapsed = useUIStore((s) => !!s.collapsedSections[section]);

  return (
    <section aria-label={label}>
      <SectionHeader label={label} section={section} count={count} />
      {isCollapsed ? null : children}
    </section>
  );
}
