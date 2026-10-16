import { EyeOffIcon } from "lucide-react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { SectionHeader } from "@/components/sidebar/SectionHeader";
import {
  ACTIVE_SHORTCUT_ROW_CLASS,
  FileSlot,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  getRowIndent,
} from "@/components/vault/tree-layout";
import {
  getVaultFileDisplayName,
  isPathWithin,
  isSamePath,
} from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import {
  useEditorStore,
  useSettingsStore,
  useUIStore,
  useVaultStore,
} from "@/store";

/** The folders between the vault and `filePath`, or "" for the vault root. */
function getFolderInVault(filePath: string, vaultPath: string) {
  const relative = filePath
    .replace(/\\/g, "/")
    .slice(vaultPath.replace(/\\/g, "/").length + 1);
  return relative.split("/").slice(0, -1).join("/");
}

function hideRecent() {
  const { setPreference } = useSettingsStore.getState();
  setPreference("showRecentFiles", false);
  toast("Recent is hidden. Turn it back on in Settings › General.", {
    action: {
      label: "Undo",
      onClick: () => setPreference("showRecentFiles", true),
    },
  });
}

export function RecentFilesSection() {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);
  const recentFiles = useUIStore((s) => s.recentFiles);
  const isCollapsed = useUIStore((s) => s.collapsedSections.recent);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const showRecentFiles = useSettingsStore((s) => s.showRecentFiles);
  const recentFilesLimit = useSettingsStore((s) => s.recentFilesLimit);

  if (!currentVaultPath || !showRecentFiles) return null;

  const visibleRecentFiles = recentFiles
    .filter((file) => isPathWithin(file.path, currentVaultPath))
    .slice(0, recentFilesLimit);

  if (visibleRecentFiles.length === 0) return null;

  return (
    <section aria-label="Recent" className="shrink-0">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <SectionHeader label="Recent" section="recent" />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={hideRecent}>
            <EyeOffIcon />
            Hide Recent
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isCollapsed ? null : (
        <ul className="flex flex-col gap-0.5">
          {visibleRecentFiles.map((file) => {
            const folder = getFolderInVault(file.path, currentVaultPath);
            const isOpen =
              !!currentFilePath && isSamePath(file.path, currentFilePath);

            return (
              <li key={file.path}>
                <div
                  className={cn(ROW_CLASS, isOpen && ACTIVE_SHORTCUT_ROW_CLASS)}
                  style={{ paddingLeft: `${getRowIndent(0)}px` }}
                >
                  <button
                    type="button"
                    className={ROW_BUTTON_CLASS}
                    onClick={async () => {
                      try {
                        await openVaultFile(file.path);
                        setActiveNavItem(null);
                      } catch (error) {
                        console.error("Failed to open recent file:", error);
                      }
                    }}
                  >
                    <FileSlot path={file.path} />
                    <span className="min-w-0 flex-1 truncate">
                      {getVaultFileDisplayName(file.name)}
                    </span>
                    {folder ? (
                      <span className="min-w-0 max-w-[45%] shrink truncate pl-1.5 text-ui-sm text-muted-foreground">
                        {folder}
                      </span>
                    ) : null}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
