import { useEffect } from "react";
import {
  ArrowsClockwiseIcon,
  FolderSimpleIcon,
  GearSixIcon,
  InfoIcon,
  KeyboardIcon,
  PaintBrushIcon,
  PaperclipIcon,
  PencilLineIcon,
  type Icon,
} from "@phosphor-icons/react";

import { AboutSettings } from "@/components/settings/sections/AboutSettings";
import { AppearanceSettings } from "@/components/settings/sections/AppearanceSettings";
import { EditorSettings } from "@/components/settings/sections/EditorSettings";
import { FilesSettings } from "@/components/settings/sections/FilesSettings";
import { GeneralSettings } from "@/components/settings/sections/GeneralSettings";
import { ShortcutsSettings } from "@/components/settings/sections/ShortcutsSettings";
import { SyncSettings } from "@/components/settings/sections/SyncSettings";
import { VaultSettings } from "@/components/settings/sections/VaultSettings";
import { cn } from "@/lib/utils";
import { type SettingsCategory, useUIStore } from "@/store/ui";

type Category = {
  id: SettingsCategory;
  label: string;
  icon: Icon;
  Content: () => React.ReactNode;
};

export const SETTINGS_CATEGORIES: Category[] = [
  {
    id: "general",
    label: "General",
    icon: GearSixIcon,
    Content: GeneralSettings,
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaintBrushIcon,
    Content: AppearanceSettings,
  },
  {
    id: "editor",
    label: "Editor",
    icon: PencilLineIcon,
    Content: EditorSettings,
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
    icon: ArrowsClockwiseIcon,
    Content: SyncSettings,
  },
  {
    id: "vault",
    label: "Vault",
    icon: FolderSimpleIcon,
    Content: VaultSettings,
  },
  {
    id: "shortcuts",
    label: "Shortcuts",
    icon: KeyboardIcon,
    Content: ShortcutsSettings,
  },
  {
    id: "about",
    label: "About",
    icon: InfoIcon,
    Content: AboutSettings,
  },
];

export function SettingsPage() {
  const categoryId = useUIStore((s) => s.settingsCategory);
  const openSettings = useUIStore((s) => s.openSettings);
  const setActiveNavItem = useUIStore((s) => s.setActiveNavItem);
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
      <nav
        aria-label="Settings"
        className="flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-sidebar px-3 py-6"
      >
        <h1 className="px-2.5 pb-3 font-semibold text-base tracking-tight">
          Settings
        </h1>
        {SETTINGS_CATEGORIES.map(({ id, label, icon: Icon }) => {
          const active = id === category.id;
          return (
            <button
              key={id}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => openSettings(id)}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm outline-none transition-colors",
                "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                active && "bg-sidebar-accent font-medium text-foreground",
              )}
            >
              <Icon
                className="size-4 shrink-0"
                weight={active ? "fill" : "regular"}
              />
              {label}
            </button>
          );
        })}
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
