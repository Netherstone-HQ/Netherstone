import {
  type CSSProperties,
  lazy,
  type RefObject,
  Suspense,
  useEffect,
  useRef,
  useState,
} from "react";
import { ListTreeIcon } from "lucide-react";
import { HistoryPanel } from "@/components/history/HistoryPanel";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import { ASSISTANT_WIDTH, SHARD_MIN_WIDTH } from "@/store/ui";
import { useAssistantStore } from "@/store/assistant";
import { useEditorStore } from "@/store/editor";
import { useHistoryStore } from "@/store/history";
import { DetailsSection } from "./right-sidebar/DetailsSection";
import { LinkedFromSection } from "./right-sidebar/LinkedFromSection";
import { LinksSection } from "./right-sidebar/LinksSection";
import { OutlineSection } from "./right-sidebar/OutlineSection";
import { useIndexedShard, useShardLinks } from "./right-sidebar/useShardInfo";
import { usePanelResize } from "./usePanelResize";

// Loaded the first time the assistant opens.
const AssistantPanel = lazy(() =>
  import("@/components/assistant/AssistantPanel").then((module) => ({
    default: module.AssistantPanel,
  })),
);

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

/** The assistant panel's left edge, dragged to size it like the left sidebar. */
function AssistantResizeHandle({
  containerRef,
  maxWidth,
  onDragging,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  /** As wide as it goes with the shard's room kept. */
  maxWidth: number;
  onDragging: (dragging: boolean) => void;
}) {
  const width = useUIStore((s) => s.assistantWidth);
  const setWidth = useUIStore((s) => s.setAssistantWidth);
  const { onPointerDown, reset } = usePanelResize({
    containerRef,
    cssVar: "--assistant-width",
    width,
    setWidth,
    defaultWidth: ASSISTANT_WIDTH.default,
    minWidth: ASSISTANT_WIDTH.min,
    maxWidth,
    side: "right",
    onDragging,
  });
  return (
    <div
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onDoubleClick={reset}
      className="absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize after:absolute after:inset-y-0 after:left-0 after:w-0.5 hover:after:bg-sidebar-border"
    />
  );
}

/**
 * The assistant's width, narrowed down to its least so the shard beside it
 * keeps room to read and edit in a narrow window.
 */
function useFittedWidth(
  containerRef: RefObject<HTMLDivElement | null>,
  width: number,
) {
  const [room, setRoom] = useState<number | null>(null);
  useEffect(() => {
    // The row the shard and the panel share.
    const row = containerRef.current?.parentElement;
    if (!row) return;
    const observer = new ResizeObserver(() => setRoom(row.clientWidth));
    observer.observe(row);
    return () => observer.disconnect();
  }, [containerRef]);
  const most =
    room === null
      ? ASSISTANT_WIDTH.max
      : Math.min(ASSISTANT_WIDTH.max, Math.max(ASSISTANT_WIDTH.min, room - SHARD_MIN_WIDTH));
  return { width: Math.min(width, most), most };
}

/**
 * The open shard's outline, links and details, or its history or the
 * assistant in their place.
 */
export function RightSidebar() {
  const isSidebarOpen = useUIStore((s) => s.isRightSidebarOpen);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const deletedPath = useHistoryStore((s) => s.deletedPath);
  const hasShard = openPath !== null;
  const filePath = deletedPath ?? openPath;
  const isHistoryOpen = useHistoryStore((s) => s.openIn === "notes");
  const closeHistory = useHistoryStore((s) => s.closeHistory);
  const showsHistory = isHistoryOpen && filePath !== null;
  const showsAssistant = useAssistantStore(
    (s) => s.isOpen && s.enabled === true && !showsHistory,
  );
  const isCovered = showsHistory || showsAssistant;
  const isOpen = isSidebarOpen && !isCovered;
  const isPanelOpen = isSidebarOpen || isCovered;

  // The panel slides as it opens or closes; History, the assistant and the
  // sidebar swap in place.
  const [shown, setShown] = useState({
    isPanelOpen,
    showsHistory,
    showsAssistant,
  });
  const [slides, setSlides] = useState(true);
  const [resizing, setResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const assistantWidth = useUIStore((s) => s.assistantWidth);
  const fitted = useFittedWidth(containerRef, assistantWidth);
  if (
    shown.isPanelOpen !== isPanelOpen ||
    shown.showsHistory !== showsHistory ||
    shown.showsAssistant !== showsAssistant
  ) {
    setShown({ isPanelOpen, showsHistory, showsAssistant });
    setSlides(shown.isPanelOpen !== isPanelOpen);
  }

  // Opened in a window too narrow for the shard beside it even at its least,
  // the assistant folds the file list away.
  useEffect(() => {
    if (!showsAssistant) return;
    const row = containerRef.current?.parentElement;
    if (!row || row.clientWidth - ASSISTANT_WIDTH.min >= SHARD_MIN_WIDTH) return;
    const { isSidebarOpen, setSidebarOpen } = useUIStore.getState();
    if (isSidebarOpen) setSidebarOpen(false);
  }, [showsAssistant]);

  // Closing the shard closes its history.
  useEffect(() => {
    if (isHistoryOpen && !hasShard && deletedPath === null) closeHistory();
  }, [isHistoryOpen, hasShard, deletedPath, closeHistory]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative shrink-0 overflow-hidden",
        slides && !resizing && "transition-[width] duration-200 ease-linear",
        !isPanelOpen ? "w-0" : showsAssistant ? "w-(--assistant-width)" : "w-72",
      )}
      style={{ "--assistant-width": `${fitted.width}px` } as CSSProperties}
      inert={!isPanelOpen}
    >
      {showsHistory ? (
        <div className="absolute inset-y-0 right-0">
          <HistoryPanel place="notes" filePath={filePath} />
        </div>
      ) : null}
      {showsAssistant ? (
        <div className="absolute inset-y-0 right-0">
          <Suspense fallback={null}>
            <AssistantPanel />
          </Suspense>
          <AssistantResizeHandle
            containerRef={containerRef}
            maxWidth={fitted.most}
            onDragging={setResizing}
          />
        </div>
      ) : null}
      <aside
        aria-label="Right sidebar"
        className={cn(
          "absolute inset-y-0 flex w-72 flex-col gap-3 overflow-y-auto border-l bg-sidebar p-2",
          slides && "transition-[right] duration-200 ease-linear",
          isSidebarOpen ? "right-0" : "-right-72",
          isCovered && "invisible",
        )}
      >
        {hasShard ? (
          <ShardSections isOpen={isOpen} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 pb-12">
            <div className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <ListTreeIcon className="size-4.5" />
            </div>
            <p className="text-ui-sm text-muted-foreground">No shard open</p>
          </div>
        )}
      </aside>
    </div>
  );
}
