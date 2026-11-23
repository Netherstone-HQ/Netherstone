import { useEffect } from "react";
import {
  EllipsisVerticalIcon,
  SearchIcon,
  SparklesIcon,
} from "lucide-react";
import { EditorOrVersion } from "@/components/AppLayout";
import { ExcalidrawView } from "@/components/ExcalidrawView";
import { loadAssistantEnabled } from "@/lib/assistant";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
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

  return (
    <PhoneFrame>
      <PhoneTopBar>
        <PhoneBackButton />
        <div className="flex-1" />
        <PhoneIconButton label="Search" onClick={() => push({ kind: "search" })}>
          <SearchIcon />
        </PhoneIconButton>
        {assistantOn ? (
          <PhoneIconButton
            label="Assistant"
            onClick={() => push({ kind: "assistant" })}
          >
            <SparklesIcon />
          </PhoneIconButton>
        ) : null}
        <PhoneIconButton label="More" onClick={() => push({ kind: "shard-menu" })}>
          <EllipsisVerticalIcon />
        </PhoneIconButton>
      </PhoneTopBar>
      <div className="relative flex min-h-0 flex-1">
        <EditorOrVersion />
      </div>
    </PhoneFrame>
  );
}
