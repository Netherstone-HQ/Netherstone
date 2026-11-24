import {
  ChevronRightIcon,
  CloudIcon,
  FolderIcon,
  InfoIcon,
  MicIcon,
  PaletteIcon,
  PaperclipIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  TypeIcon,
  type LucideIcon,
} from "lucide-react";
import { Fragment } from "react";
import { SETTINGS_CATEGORIES } from "@/components/settings/SettingsPage";
import type { SettingsCategory } from "@/store/ui";
import { useVaultStore } from "@/store";
import { useSyncStore } from "@/store/sync";
import { usePhoneNav } from "./nav";
import { PhoneBackButton, PhoneFrame, PhoneTitle, PhoneTopBar } from "./parts";
import { syncStatusLabel, useSyncProblem } from "./SyncStrip";

/**
 * The phone's settings, in groups. Shortcuts need a keyboard and AI apps
 * aren't on phones, so neither is listed.
 */
const PHONE_GROUPS: { id: SettingsCategory; icon: LucideIcon }[][] = [
  [
    { id: "general", icon: SlidersHorizontalIcon },
    { id: "appearance", icon: PaletteIcon },
    { id: "editor", icon: TypeIcon },
    { id: "microphone", icon: MicIcon },
  ],
  [
    { id: "vault", icon: FolderIcon },
    { id: "files", icon: PaperclipIcon },
    { id: "sync", icon: CloudIcon },
  ],
  [
    { id: "ai-assistant", icon: SparkleIcon },
    { id: "about", icon: InfoIcon },
  ],
];

function categoryOf(id: SettingsCategory) {
  return SETTINGS_CATEGORIES.find((category) => category.id === id);
}

/** Settings: the list, or one category's settings. */
export function SettingsScreen({
  category,
}: {
  category: SettingsCategory | null;
}) {
  const shown = category ? categoryOf(category) : null;
  return (
    <PhoneFrame>
      <PhoneTopBar>
        <PhoneBackButton />
        <PhoneTitle>{shown?.label ?? "Settings"}</PhoneTitle>
      </PhoneTopBar>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {shown ? (
          <div className="flex flex-col gap-8 px-4 pt-2 pb-8">
            <shown.Content />
          </div>
        ) : (
          <SettingsList />
        )}
      </div>
    </PhoneFrame>
  );
}

function SettingsList() {
  const push = usePhoneNav((s) => s.push);
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const syncOn = useSyncStore(
    (s) => s.vaultPath === vaultPath && !!s.record?.syncEnabled,
  );
  const problem = useSyncProblem(vaultPath);

  return (
    <nav aria-label="Settings">
      {PHONE_GROUPS.map((group, at) => (
        <Fragment key={at}>
          {at > 0 ? (
            <div role="separator" className="mx-4 my-2 h-px bg-border" />
          ) : null}
          {group.map(({ id, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className="flex h-14 w-full items-center gap-4 px-4 text-left outline-none active:bg-accent"
              onClick={() => push({ kind: "settings", category: id })}
            >
              <Icon className="size-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {categoryOf(id)?.label}
              </span>
              {id === "sync" ? (
                <span className="text-sm text-muted-foreground">
                  {syncStatusLabel(syncOn, problem)}
                </span>
              ) : null}
              <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" />
            </button>
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
