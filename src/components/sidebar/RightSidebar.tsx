import { useEffect } from "react";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import { useEditorStore } from "@/store/editor";
import { useHistoryStore } from "@/store/history";
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

/** The open shard's outline, links and details, or its history in their place. */
export function RightSidebar() {
  const isSidebarOpen = useUIStore((s) => s.isRightSidebarOpen);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const deletedPath = useHistoryStore((s) => s.deletedPath);
  const hasShard = openPath !== null;
  const filePath = deletedPath ?? openPath;
  const isHistoryOpen = useHistoryStore((s) => s.openIn === "notes");
  const closeHistory = useHistoryStore((s) => s.closeHistory);
  const showsHistory = isHistoryOpen && filePath !== null;
  const isOpen = isSidebarOpen && !showsHistory;

  // Closing the shard closes its history.
  useEffect(() => {
    if (isHistoryOpen && !hasShard && deletedPath === null) closeHistory();
  }, [isHistoryOpen, hasShard, deletedPath, closeHistory]);

  return (
    <div
      className={cn(
        "relative shrink-0 overflow-hidden transition-[width] duration-200 ease-linear",
        showsHistory ? "w-80" : isOpen ? "w-72" : "w-0",
      )}
      inert={!isOpen && !showsHistory}
    >
      {showsHistory ? (
        <div className="absolute inset-y-0 right-0">
          <HistoryPanel place="notes" filePath={filePath} />
        </div>
      ) : null}
      <aside
        aria-label="Right sidebar"
        className={cn(
          "absolute inset-y-0 flex w-72 flex-col gap-3 overflow-y-auto border-l bg-sidebar p-2 transition-[right] duration-200 ease-linear",
          isOpen ? "right-0" : "-right-72",
          showsHistory && "invisible",
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
