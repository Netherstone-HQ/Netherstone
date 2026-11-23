import { useEffect } from "react";
import { useLaunches } from "@/lib/launch";
import { useUIStore } from "@/store/ui";
import { useEditorStore, useVaultStore } from "@/store";
import { createFolderIn, createShardIn } from "./create";
import { FileScreen } from "./FileScreen";
import { FolderScreen } from "./FolderScreen";
import { HomeScreen } from "./HomeScreen";
import { MoreMenu } from "./MoreMenu";
import { NameSheet } from "./NameSheet";
import {
  followBrowserHistory,
  usePhoneNav,
  usePhoneOverlay,
  usePhoneScreen,
  useSelecting,
  type PhoneOverlay,
} from "./nav";
import { RowActions } from "./RowActions";
import { SearchScreen } from "./SearchScreen";
import { SettingsScreen } from "./SettingsScreen";
import { TagsScreen } from "./TagsScreen";
import { usePhoneSelection } from "./selection";
import { ShardMenuSheet } from "./ShardMenuSheet";
import { VaultMenuSheet } from "./VaultMenuSheet";

/**
 * Closes `kind` when its sheet or menu asks to: steps back, unless a tap in
 * it already put something else on top.
 */
function useCloser(kind: PhoneOverlay["kind"]) {
  return (open: boolean) => {
    if (open) return;
    const { entries, back } = usePhoneNav.getState();
    if (entries[entries.length - 1]?.kind === kind) back();
  };
}

/** The app on a phone: one screen at a time, with sheets over it. */
export function PhoneApp() {
  const screen = usePhoneScreen();
  const overlay = usePhoneOverlay();
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  useLaunches();

  useEffect(() => followBrowserHistory(), []);
  useEffect(() => followSettingsRequests(), []);

  const selecting = useSelecting();
  useEffect(() => {
    if (!selecting) usePhoneSelection.getState().set([]);
  }, [selecting]);

  const closeVaultMenu = useCloser("vault-menu");
  const closeMoreMenu = useCloser("more-menu");
  const closeNewFolder = useCloser("new-folder");
  const closeNewShard = useCloser("new-shard");
  const closeShardMenu = useCloser("shard-menu");

  return (
    <>
      {screen.kind === "folder" ? (
        <FolderScreen key={screen.path} path={screen.path} />
      ) : screen.kind === "file" ? (
        <FileScreen />
      ) : screen.kind === "search" ? (
        <SearchScreen entry={screen} />
      ) : screen.kind === "tags" ? (
        <TagsScreen />
      ) : screen.kind === "settings" ? (
        <SettingsScreen key={screen.category} category={screen.category} />
      ) : (
        <HomeScreen />
      )}

      <VaultMenuSheet
        open={overlay?.kind === "vault-menu"}
        onOpenChange={closeVaultMenu}
      />
      {overlay?.kind === "more-menu" && overlay.folder ? (
        <MoreMenu
          folder={overlay.folder}
          onClose={() => closeMoreMenu(false)}
        />
      ) : null}
      {vaultPath ? (
        <>
          <NameSheet
            open={overlay?.kind === "new-folder"}
            onOpenChange={closeNewFolder}
            title="New folder"
            onCreate={(name) =>
              overlay?.kind === "new-folder"
                ? createFolderIn(vaultPath, overlay.parent, name)
                : Promise.resolve(null)
            }
          />
          <NameSheet
            open={overlay?.kind === "new-shard"}
            onOpenChange={closeNewShard}
            title="New shard"
            onCreate={(name) =>
              overlay?.kind === "new-shard"
                ? createShardIn(vaultPath, overlay.folder, name)
                : Promise.resolve(null)
            }
          />
        </>
      ) : null}
      <RowActions />
      {screen.kind === "file" && openPath ? (
        <ShardMenuSheet
          path={openPath}
          open={overlay?.kind === "shard-menu"}
          onOpenChange={closeShardMenu}
        />
      ) : null}
    </>
  );
}

/**
 * Opens the Settings screen when something asks the desktop way, such as
 * a "Set up" link in the assistant. Returns a cleanup.
 */
function followSettingsRequests(): () => void {
  const take = () => {
    const { activeNavItem, settingsCategory, setActiveNavItem } =
      useUIStore.getState();
    if (activeNavItem !== "settings") return false;
    setActiveNavItem(null);
    return settingsCategory;
  };
  // Settings left open on a computer before doesn't open on start.
  take();
  return useUIStore.subscribe((state, prev) => {
    if (
      state.activeNavItem === "settings" &&
      prev.activeNavItem !== "settings"
    ) {
      const category = take();
      if (category) usePhoneNav.getState().push({ kind: "settings", category });
    }
  });
}
