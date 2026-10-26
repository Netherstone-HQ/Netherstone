import { Separator } from "@/components/ui/separator";
import { closeEditorFile, saveEditorFile } from "@/lib/open-editor-file";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
import { useEditorStore } from "@/store";
import { useHistoryStore } from "@/store/history";
import { AutosaveIndicator } from "./editor/AutosaveIndicator";
import { WordCount } from "./editor/WordCount";
import {
  BrowserPanelToggle,
  LeftSidebarToggle,
  RightSidebarToggle,
} from "./PanelToggles";
import { HistoryToggle } from "./history/HistoryToggle";
import { FileBreadcrumb } from "./vault/FileBreadcrumb";

const saveShard = () => void saveEditorFile();
const closeShard = () => void closeEditorFile();

/** A deleted shard's name, while its history is open. */
function DeletedShardName({ path }: { path: string }) {
  return (
    <span className="min-w-0 truncate px-1.5 font-medium text-ui">
      {getVaultFileDisplayName(path.split(/[\\/]/).pop() ?? path)}
    </span>
  );
}

/** The Editor's top bar: where the open shard is, and its save state. */
export function AppHeader() {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const deletedPath = useHistoryStore((s) => s.deletedPath);

  return (
    <header className="flex h-header shrink-0 items-center gap-1.5 border-b px-2.5">
      <LeftSidebarToggle />
      <Separator
        orientation="vertical"
        className="mx-1 h-4 data-vertical:self-center"
      />
      {deletedPath ? (
        <DeletedShardName path={deletedPath} />
      ) : (
        <FileBreadcrumb
          path={currentFilePath}
          onSave={saveShard}
          onClose={closeShard}
        />
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {deletedPath ? null : (
          <>
            <WordCount />
            <AutosaveIndicator />
          </>
        )}
        {currentFilePath || deletedPath ? (
          <HistoryToggle place="notes" />
        ) : null}
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
