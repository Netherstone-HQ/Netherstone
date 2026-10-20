import { Separator } from "@/components/ui/separator";
import { closeEditorFile } from "@/lib/open-editor-file";
import { useEditorStore } from "@/store";
import { AutosaveIndicator } from "./editor/AutosaveIndicator";
import { WordCount } from "./editor/WordCount";
import {
  BrowserPanelToggle,
  LeftSidebarToggle,
  RightSidebarToggle,
} from "./PanelToggles";
import { HistoryToggle } from "./history/HistoryToggle";
import { FileBreadcrumb } from "./vault/FileBreadcrumb";

const closeShard = () => void closeEditorFile();

/** The Editor's top bar: where the open shard is, and its save state. */
export function AppHeader() {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);

  return (
    <header className="flex h-header shrink-0 items-center gap-1.5 border-b px-2.5">
      <LeftSidebarToggle />
      <Separator
        orientation="vertical"
        className="mx-1 h-4 data-vertical:self-center"
      />
      <FileBreadcrumb path={currentFilePath} onClose={closeShard} />
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <WordCount />
        <AutosaveIndicator />
        {currentFilePath ? <HistoryToggle place="notes" /> : null}
        <BrowserPanelToggle />
        <Separator
          orientation="vertical"
          className="mx-0.5 h-4 data-vertical:self-center"
        />
        <RightSidebarToggle />
      </div>
    </header>
  );
}
