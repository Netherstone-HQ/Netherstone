import { useEffect } from "react";
import {
  FolderIcon,
  InfoIcon,
  KeyboardIcon,
  PaintbrushIcon,
  PaperclipIcon,
  PencilLineIcon,
  RefreshCwIcon,
  SettingsIcon,
  type LucideIcon,
} from "lucide-react";

import { AboutSettings } from "@/components/settings/sections/AboutSettings";
import { AppearanceSettings } from "@/components/settings/sections/AppearanceSettings";
import { EditorSettings } from "@/components/settings/sections/EditorSettings";
import { FilesSettings } from "@/components/settings/sections/FilesSettings";
import { GeneralSettings } from "@/components/settings/sections/GeneralSettings";
import { ShortcutsSettings } from "@/components/settings/sections/ShortcutsSettings";
import { SyncSettings } from "@/components/settings/sections/SyncSettings";
import { VaultSettings } from "@/components/settings/sections/VaultSettings";
import {
  ACTIVE_ROW_CLASS,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  RowSlot,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { cn } from "@/lib/utils";
import { type SettingsCategory, useUIStore } from "@/store/ui";

type Category = {
  id: SettingsCategory;
  label: string;
  icon: LucideIcon;
  Content: () => React.ReactNode;
  /** Starts a new group of related categories, set apart by a gap. */
  startsGroup?: boolean;
};

export const SETTINGS_CATEGORIES: Category[] = [
  {
    id: "general",
    label: "General",
    icon: SettingsIcon,
    Content: GeneralSettings,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaintbrushIcon,
    Content: AppearanceSettings,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    Content: ShortcutsSettings,
  },
  {
    id: "editor",
    label: "Editor",
    icon: PencilLineIcon,
    Content: EditorSettings,
    startsGroup: true,
  },
  {
    id: "vault",
    label: "Vault",
    icon: FolderIcon,
    Content: VaultSettings,
    startsGroup: true,
  },
  {
    id: "files",
    label: "Files & attachments",
    icon: PaperclipIcon,
    Content: FilesSettings,
  },
  {
    id: "sync",
    label: "Sync & backup",
    icon: RefreshCwIcon,
    Content: SyncSettings,
  },
  {
    id: "about",
    label: "About",
    icon: InfoIcon,
    Content: AboutSettings,
    startsGroup: true,
  },
];

export function SettingsPage() {
  const categoryId = useUIStore((s) => s.settingsCategory);
  const openSettings = useUIStore((s) => s.openSettings);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const category =
    SETTINGS_CATEGORIES.find((c) => c.id === categoryId) ??
    SETTINGS_CATEGORIES[0];

  // Escape closes Settings, unless a dialog or menu inside it handles it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) setActiveNavItem(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [setActiveNavItem]);

  return (
    <div className="flex h-full min-h-0">
      {/* Sized and laid out like the left sidebar, whose place it takes. */}
      <nav
        aria-label="Settings"
        className="flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
        style={{ width: sidebarWidth }}
      >
        <div className="flex h-header shrink-0 items-center border-b px-4">
          <h1 className="font-medium text-ui">Settings</h1>
        </div>
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {SETTINGS_CATEGORIES.map(
            ({ id, label, icon: Icon, startsGroup }) => {
              const active = id === category.id;
              return (
                <li key={id} className={startsGroup ? "mt-3" : undefined}>
                  <div
                    className={cn(ROW_CLASS, active && ACTIVE_ROW_CLASS)}
                    style={{ paddingLeft: `${getRowIndent(0)}px` }}
                  >
                    <button
                      type="button"
                      aria-current={active ? "page" : undefined}
                      onClick={() => openSettings(id)}
                      className={ROW_BUTTON_CLASS}
                    >
                      <RowSlot>
                        <Icon className="size-4 text-muted-foreground" />
                      </RowSlot>
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                    </button>
                  </div>
                </li>
              );
            },
          )}
        </ul>
      </nav>

      <div className="min-w-0 flex-1 overflow-y-auto">
        <div
          key={category.id}
          className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-10 pt-10 pb-16"
        >
          <h2 className="font-semibold text-xl tracking-tight">
            {category.label}
          </h2>
          <category.Content />
        </div>
      </div>
    </div>
  );
}

export default SettingsPage;
