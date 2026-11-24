import { useEffect } from "react";
import { EllipsisVerticalIcon, SearchIcon, SparkleIcon } from "lucide-react";
import { EditorOrVersion } from "@/components/AppLayout";
import { ExcalidrawView } from "@/components/ExcalidrawView";
import { loadAssistantEnabled } from "@/lib/assistant";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
import { formatVersionTitle } from "@/lib/history";
import { useEditorStore } from "@/store/editor";
import { useHistoryStore } from "@/store/history";
import { useUIStore } from "@/store";
import { useAssistantStore } from "@/store/assistant";
import { usePhoneNav } from "./nav";
import {
  PhoneBackButton,
  PhoneFrame,
  PhoneIconButton,
  PhoneTitle,
  PhoneTopBar,
} from "./parts";

/**
 * The open shard under a thin top bar (Back, Search, Assistant, More), or
 * the open drawing when Canvas is the mode.
 */
export function FileScreen() {
  const appMode = useUIStore((s) => s.appMode);
  const drawingPath = useUIStore((s) => s.activeDrawingPath);
  const push = usePhoneNav((s) => s.push);
  const assistantOn = useAssistantStore((s) => s.enabled);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const version = useHistoryStore((s) =>
    s.openIn === "notes" ? s.picked : null,
  );
  const showsVersion = usePhoneNav((s) =>
    s.entries.some((entry) => entry.kind === "version"),
  );

  useEffect(() => {
    if (useAssistantStore.getState().enabled === null) {
      void loadAssistantEnabled();
    }
  }, []);

  if (appMode === "canvas") {
    return (
      <PhoneFrame>
        <PhoneTopBar>
          <PhoneBackButton />
          <PhoneTitle>
            {drawingPath
              ? getVaultFileDisplayName(drawingPath.split(/[\\/]/).pop() ?? "")
              : null}
          </PhoneTitle>
        </PhoneTopBar>
        <main className="min-h-0 flex-1">
          <ExcalidrawView />
        </main>
      </PhoneFrame>
    );
  }

  if (showsVersion && version && openPath) {
    return (
      <PhoneFrame>
        <PhoneTopBar>
          <PhoneBackButton />
          <div className="flex min-w-0 flex-1 flex-col pl-1">
            <h1 className="truncate font-semibold">
              {getVaultFileDisplayName(openPath.split(/[\\/]/).pop() ?? "")}
            </h1>
            <p className="truncate text-sm text-muted-foreground">
              {formatVersionTitle(version.time)}
            </p>
          </div>
        </PhoneTopBar>
        <div className="relative flex min-h-0 flex-1">
          <EditorOrVersion />
        </div>
      </PhoneFrame>
    );
  }

  return (
    <PhoneFrame>
      <PhoneTopBar>
        <PhoneBackButton />
        <div className="flex-1" />
        <PhoneIconButton
          label="Search"
          onClick={() => push({ kind: "search" })}
        >
          <SearchIcon />
        </PhoneIconButton>
        {assistantOn ? (
          <PhoneIconButton
            label="Assistant"
            onClick={() => push({ kind: "assistant" })}
          >
            <SparkleIcon />
          </PhoneIconButton>
        ) : null}
        <PhoneIconButton
          label="More"
          onClick={() => push({ kind: "shard-menu" })}
        >
          <EllipsisVerticalIcon />
        </PhoneIconButton>
      </PhoneTopBar>
      <div className="relative flex min-h-0 flex-1">
        <EditorOrVersion />
      </div>
    </PhoneFrame>
  );
}
