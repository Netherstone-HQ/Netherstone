import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import {
  ArrowRightIcon,
  CircleIcon,
  DiamondIcon,
  EllipsisVerticalIcon,
  EraserIcon,
  HistoryIcon,
  MousePointer2Icon,
  PencilIcon,
  SquareIcon,
  TypeIcon,
  Undo2Icon,
} from "lucide-react";
import { DrawingVersionView } from "@/components/history/DrawingVersionView";
import type { SaveState } from "@/components/SaveStatus";
import { useThemeMode } from "@/components/theme/theme-provider";
import { Button } from "@/components/ui/button";
import { Dot } from "@/components/ui/dot";
import { getParentFolder, getVaultFileDisplayName } from "@/lib/drawing-files";
import { folderName } from "@/lib/open-vault";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";
import { useShownVersion } from "@/store/history";
import { usePhoneNav } from "./nav";
import { openHistoryScreen } from "./open-file";
import { PhoneBackButton, PhoneFrame, PhoneIconButton, PhoneTopBar } from "./parts";

const ExcalidrawCanvas = lazy(() =>
  import("@/components/ExcalidrawCanvas").then((mod) => ({
    default: mod.ExcalidrawCanvas,
  })),
);

/** The tools of the bar under a drawing being edited, as Excalidraw names them. */
const TOOLS = [
  { type: "selection", label: "Select", icon: <MousePointer2Icon /> },
  { type: "rectangle", label: "Rectangle", icon: <SquareIcon /> },
  { type: "diamond", label: "Diamond", icon: <DiamondIcon /> },
  { type: "ellipse", label: "Ellipse", icon: <CircleIcon /> },
  { type: "arrow", label: "Arrow", icon: <ArrowRightIcon /> },
  { type: "freedraw", label: "Draw", icon: <PencilIcon /> },
  { type: "text", label: "Text", icon: <TypeIcon /> },
  { type: "eraser", label: "Eraser", icon: <EraserIcon /> },
] as const;

type ToolType = (typeof TOOLS)[number]["type"];

const SAVE_TEXT: Record<SaveState, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Not saved yet",
  failed: "Couldn't save",
};

/** "Drawings" for a drawing in that folder: where it is, under its name. */
function folderOf(path: string) {
  return folderName(getParentFolder(path));
}

/**
 * A drawing on a phone: looked at first, moved and zoomed with the fingers,
 * then edited after Edit, with a bar of tools under it. A new, empty
 * drawing opens ready to draw.
 */
export function DrawingScreen() {
  const drawingPath = useUIStore((s) => s.activeDrawingPath);
  const sessionKey = useUIStore((s) => s.drawingSessionKey);
  const theme = useThemeMode();
  const push = usePhoneNav((s) => s.push);
  const shownVersion = useShownVersion("canvas");
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<string>("selection");
  const [zoom, setZoom] = useState(1);

  // An empty drawing is there to be drawn in.
  useEffect(() => {
    if (!api) return;
    if (api.getSceneElements().length === 0) setEditing(true);
    return api.onChange((_elements, appState) => {
      setTool(appState.activeTool.type);
      setZoom(appState.zoom.value);
    });
  }, [api]);

  const name = drawingPath
    ? getVaultFileDisplayName(drawingPath.split(/[\\/]/).pop() ?? "")
    : "";

  /** Excalidraw's own Undo, hidden with the rest of its tools. */
  const undo = () =>
    document
      .querySelector<HTMLButtonElement>(".phone-drawing .excalidraw button[aria-label='Undo']")
      ?.click();

  const pick = (type: ToolType) => api?.setActiveTool({ type });

  const more = () => {
    if (drawingPath) push({ kind: "row-menu", path: drawingPath });
  };

  return (
    <PhoneFrame>
      <PhoneTopBar>
        {editing ? (
          <Button
            type="button"
            variant="ghost"
            className="h-12 px-3 text-base font-semibold"
            onClick={() => {
              api?.setActiveTool({ type: "selection" });
              setEditing(false);
            }}
          >
            Done
          </Button>
        ) : (
          <PhoneBackButton />
        )}
        <div className="flex min-w-0 flex-1 flex-col pl-1">
          <h1 className="truncate font-semibold">{name}</h1>
          {drawingPath ? (
            <p className="flex items-center truncate text-sm text-muted-foreground">
              {folderOf(drawingPath)}
              <Dot />
              {SAVE_TEXT[saveState]}
            </p>
          ) : null}
        </div>
        {editing ? (
          <PhoneIconButton label="Undo" onClick={undo}>
            <Undo2Icon />
          </PhoneIconButton>
        ) : drawingPath ? (
          <PhoneIconButton
            label="History"
            onClick={() => openHistoryScreen(drawingPath)}
          >
            <HistoryIcon />
          </PhoneIconButton>
        ) : null}
        {drawingPath ? (
          <PhoneIconButton label="More" onClick={more}>
            <EllipsisVerticalIcon />
          </PhoneIconButton>
        ) : null}
      </PhoneTopBar>

      <main className="relative min-h-0 flex-1">
        <div className={cn("h-full", shownVersion && "invisible")} inert={shownVersion !== null}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-muted-foreground">
                Loading drawing…
              </div>
            }
          >
            <ExcalidrawCanvas
              key={sessionKey}
              drawingPath={drawingPath}
              theme={theme}
              libraryReturnUrl={window.location.origin + window.location.pathname}
              excalidrawAPI={api}
              onExcalidrawAPI={setApi}
              onSaveStateChange={setSaveState}
              phone={{ editing }}
            />
          </Suspense>
        </div>
        {shownVersion && drawingPath ? (
          <DrawingVersionView
            version={shownVersion}
            filePath={drawingPath}
            liveCanvas={api}
            theme={theme}
          />
        ) : null}
      </main>

      {editing ? (
        <nav
          aria-label="Drawing tools"
          className="flex h-16 shrink-0 items-center justify-around border-t border-border bg-sidebar px-1"
        >
          {TOOLS.map((item) => (
            <ToolButton
              key={item.type}
              label={item.label}
              on={tool === item.type}
              onClick={() => pick(item.type)}
            >
              {item.icon}
            </ToolButton>
          ))}
        </nav>
      ) : (
        <div className="flex h-16 shrink-0 items-center justify-between border-t border-border bg-sidebar px-4">
          <button
            type="button"
            className="h-11 rounded-lg px-2 text-sm text-muted-foreground active:bg-accent"
            aria-label="Zoom to fit the drawing"
            onClick={() => api?.scrollToContent(undefined, { fitToViewport: true })}
          >
            {Math.round(zoom * 100)}%
          </button>
          <Button type="button" className="h-11 px-5 text-base" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
    </PhoneFrame>
  );
}

function ToolButton({
  label,
  on,
  onClick,
  children,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "flex size-11 items-center justify-center rounded-xl text-foreground outline-none [&_svg]:size-5",
        on && "bg-accent",
      )}
    >
      {children}
    </button>
  );
}
