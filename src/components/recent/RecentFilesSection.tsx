import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { cn } from "@/lib/utils";
import {
  useEditorStore,
  useSettingsStore,
  useUIStore,
  useVaultStore,
} from "@/store";

function getVaultRelativePath(
  filePath: string,
  currentVaultPath: string | null,
) {
  if (!currentVaultPath) return filePath;

  const normalizedVaultPath = currentVaultPath.replace(/\\/g, "/");
  const normalizedFilePath = filePath.replace(/\\/g, "/");

  if (!normalizedFilePath.startsWith(normalizedVaultPath)) {
    return filePath.split(/[\\/]/).pop() ?? filePath;
  }

  const relativePath = normalizedFilePath
    .slice(normalizedVaultPath.length)
    .replace(/^\//, "");
  return relativePath || (filePath.split(/[\\/]/).pop() ?? filePath);
}

export function RecentFilesSection() {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);
  const recentFiles = useUIStore((s) => s.recentFiles);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const showRecentFiles = useSettingsStore((s) => s.showRecentFiles);
  const recentFilesLimit = useSettingsStore((s) => s.recentFilesLimit);

  const visibleRecentFiles = recentFiles
    .filter((file) => {
      if (!currentVaultPath) return false;

      const normalizedVaultPath = currentVaultPath.replace(/\\/g, "/");
      const normalizedFilePath = file.path.replace(/\\/g, "/");

      return (
        normalizedFilePath.startsWith(`${normalizedVaultPath}/`) ||
        normalizedFilePath === normalizedVaultPath
      );
    })
    .slice(0, recentFilesLimit);

  if (
    !currentVaultPath ||
    !showRecentFiles ||
    visibleRecentFiles.length === 0
  ) {
    return null;
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Recent</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {visibleRecentFiles.map((file) => {
            const fileName = getVaultFileDisplayName(file.name);
            const relativePath = getVaultRelativePath(
              file.path,
              currentVaultPath,
            );

            return (
              <SidebarMenuItem key={file.path}>
                <SidebarMenuButton
                  tooltip={relativePath}
                  isActive={file.path === currentFilePath}
                  onClick={async () => {
                    try {
                      await openVaultFile(file.path);
                      setActiveNavItem(null);
                    } catch (error) {
                      console.error("Failed to open recent file:", error);
                    }
                  }}
                  className="w-full min-w-0"
                >
                  <span className="min-w-0 flex-1 truncate">{fileName}</span>
                  <span
                    className={cn(
                      "min-w-0 max-w-28 truncate text-[11px] text-sidebar-foreground/50",
                      file.path === currentFilePath &&
                        "text-sidebar-accent-foreground/70",
                    )}
                  >
                    {relativePath}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export default RecentFilesSection;
