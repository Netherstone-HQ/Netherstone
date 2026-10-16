import { Input } from "@/components/ui/input";
import { SectionHeader } from "@/components/sidebar/SectionHeader";
import {
  RowActionsButton,
  RowContextMenu,
} from "@/components/vault/RowActions";
import {
  ACTIVE_SHORTCUT_ROW_CLASS,
  FileSlot,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { useVaultItem } from "@/components/vault/useVaultItem";
import { isPathWithin, isSamePath } from "@/lib/drawing-files";
import { cn } from "@/lib/utils";
import { useEditorStore, useUIStore, useVaultStore } from "@/store";
import type { RecentFileEntry } from "@/store/ui";

/** A pinned file, with the same actions as its row in the file tree. */
function PinnedRow({ file }: { file: RecentFileEntry }) {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const item = useVaultItem({ name: file.name, path: file.path, kind: "file" });
  const isOpen = !!currentFilePath && isSamePath(file.path, currentFilePath);

  return (
    <li className="group/row">
      <RowContextMenu actions={item.actions} disabled={item.isRenaming}>
        <div
          className={cn(ROW_CLASS, isOpen && ACTIVE_SHORTCUT_ROW_CLASS)}
          style={{ paddingLeft: `${getRowIndent(0)}px` }}
        >
          {item.isRenaming ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <FileSlot path={file.path} />
              <Input
                {...item.renameInputProps}
                className="h-6 min-w-0 flex-1 px-2 py-0 text-ui"
              />
            </div>
          ) : (
            <>
              <button
                type="button"
                className={ROW_BUTTON_CLASS}
                onClick={() => void item.open()}
              >
                <FileSlot path={file.path} />
                <span className="min-w-0 flex-1 truncate">
                  {item.displayName}
                </span>
              </button>
              <RowActionsButton label={item.displayName} actions={item.actions} />
            </>
          )}
        </div>
      </RowContextMenu>
      {item.dialogs}
    </li>
  );
}

/** Files pinned in this vault. Hidden until something is pinned. */
export function PinnedSection() {
  const pinnedFiles = useUIStore((s) => s.pinnedFiles);
  const isCollapsed = useUIStore((s) => s.collapsedSections.pinned);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);

  if (!currentVaultPath) return null;

  const visiblePinnedFiles = pinnedFiles.filter((file) =>
    isPathWithin(file.path, currentVaultPath),
  );

  if (visiblePinnedFiles.length === 0) return null;

  return (
    <section aria-label="Pinned" className="shrink-0">
      <SectionHeader label="Pinned" section="pinned" />
      {isCollapsed ? null : (
        <ul className="flex flex-col gap-0.5">
          {visiblePinnedFiles.map((file) => (
            <PinnedRow key={file.path} file={file} />
          ))}
        </ul>
      )}
    </section>
  );
}
