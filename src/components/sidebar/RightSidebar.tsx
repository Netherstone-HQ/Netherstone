import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import { useEditorStore } from "@/store/editor";
import { SECTION_NOTE_CLASS } from "./right-sidebar/CollapsibleSection";
import { DetailsSection } from "./right-sidebar/DetailsSection";
import { LinkedFromSection } from "./right-sidebar/LinkedFromSection";
import { LinksSection } from "./right-sidebar/LinksSection";
import { OutlineSection } from "./right-sidebar/OutlineSection";
import { useIndexedShard, useShardLinks } from "./right-sidebar/useShardInfo";

/** The open shard's sections. They only load while the sidebar is open. */
function ShardSections({ isOpen }: { isOpen: boolean }) {
  const links = useShardLinks(isOpen);
  const indexed = useIndexedShard(isOpen);

  return (
    <>
      <OutlineSection />
      <LinksSection links={links} />
      <LinkedFromSection backlinks={indexed?.linkedFrom ?? null} />
      <DetailsSection details={indexed ? indexed.details : undefined} />
    </>
  );
}

export function RightSidebar() {
  const isOpen = useUIStore((s) => s.isRightSidebarOpen);
  const hasShard = useEditorStore((s) => s.currentFilePath !== null);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden transition-[width] duration-200 ease-linear",
        isOpen ? "w-72" : "w-0",
      )}
      inert={!isOpen}
    >
      <aside
        aria-label="Right sidebar"
        className={cn(
          "absolute inset-y-0 flex w-72 flex-col gap-3 overflow-y-auto border-l bg-sidebar p-2 transition-[right] duration-200 ease-linear",
          isOpen ? "right-0" : "-right-72",
        )}
      >
        {hasShard ? (
          <ShardSections isOpen={isOpen} />
        ) : (
          <p className={SECTION_NOTE_CLASS}>
            Open a shard to see its outline, links and details.
          </p>
        )}
      </aside>
    </div>
  );
}
