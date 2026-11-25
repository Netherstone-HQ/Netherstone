import { useEffect } from "react";
import { IS_ANDROID } from "@/lib/platform";
import { copy } from "@/components/onboarding/copy";
import { isSamePath } from "@/lib/drawing-files";
import { useLaunches } from "@/lib/launch";
import { openVaultFile } from "@/lib/open-vault-file";
import { saveWhenHidden } from "@/hooks/useAutosave";
import { usePreviewedChange } from "@/lib/assistant-changes";
import { useAssistantStore } from "@/store/assistant";
import { useHistoryStore } from "@/store/history";
import { useUIStore } from "@/store/ui";
import { useEditorStore, useVaultStore } from "@/store";
import { createFolderIn, createVaultNamed } from "./create";
import { importOpened } from "./import-opened";
import { FileScreen } from "./FileScreen";
import { FolderScreen } from "./FolderScreen";
import { HomeScreen } from "./HomeScreen";
import { MoreMenu } from "./MoreMenu";
import { NameSheet } from "./NameSheet";
import {
  closer,
  followBrowserHistory,
  followSystemBack,
  usePhoneNav,
  usePhoneOverlay,
  usePhoneScreen,
  useSelecting,
} from "./nav";
import { AssistantSheet } from "./AssistantSheet";
import { HistorySheet } from "./HistorySheet";
import { RowActions } from "./RowActions";
import { SearchScreen } from "./SearchScreen";
import { SettingsScreen } from "./SettingsScreen";
import { followShares } from "./share-in";
import { ShareInSheet } from "./ShareInSheet";
import { TagsScreen } from "./TagsScreen";
import { TrashScreen } from "./TrashScreen";
import { usePhoneSelection } from "./selection";
import { ShardMenuSheet } from "./ShardMenuSheet";
import { VaultMenuSheet } from "./VaultMenuSheet";

/** The app on a phone: one screen at a time, with sheets over it. */
export function PhoneApp() {
  const screen = usePhoneScreen();
  const overlay = usePhoneOverlay();
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const openPath = useEditorStore((s) => s.currentFilePath);
  const appMode = useUIStore((s) => s.appMode);
  const drawingPath = useUIStore((s) => s.activeDrawingPath);
  // The file on screen whose history the sheet shows: the shard, or the drawing.
  const historyPath = appMode === "canvas" ? drawingPath : openPath;
  useLaunches(importOpened);

  useEffect(() => followBrowserHistory(), []);
  useEffect(() => (IS_ANDROID ? followSystemBack() : undefined), []);
  useEffect(() => (IS_ANDROID ? followShares() : undefined), []);
  useEffect(() => (IS_ANDROID ? saveWhenHidden() : undefined), []);
  useEffect(() => followSettingsRequests(), []);

  // Back from another file's screen shows this screen's file again.
  useEffect(() => {
    if (screen.kind !== "file" || !screen.path) return;
    const { appMode, activeDrawingPath } = useUIStore.getState();
    const shown =
      appMode === "canvas"
        ? activeDrawingPath
        : useEditorStore.getState().currentFilePath;
    if (shown && isSamePath(shown, screen.path)) return;
    openVaultFile(screen.path).catch((error: unknown) => {
      console.error("[Netherstone] Couldn't open the file again:", error);
      usePhoneNav.getState().back();
    });
  }, [screen]);

  const selecting = useSelecting();
  useEffect(() => {
    if (!selecting) usePhoneSelection.getState().set([]);
  }, [selecting]);

  const closeVaultMenu = closer("vault-menu");
  const closeMoreMenu = closer("more-menu");
  const closeNewFolder = closer("new-folder");
  const closeNewVault = closer("new-vault");
  const closeShardMenu = closer("shard-menu");
  const closeHistorySheet = closer("history");
  const closeAssistant = closer("assistant");
  useSheetsFollowNav();

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
      ) : screen.kind === "trash" ? (
        <TrashScreen />
      ) : (
        <HomeScreen />
      )}

      <NameSheet
        open={overlay?.kind === "new-vault"}
        onOpenChange={closeNewVault}
        title="New vault"
        initialName={copy.vault.create.defaultName}
        submitLabel={copy.vault.create.submit}
        onCreate={createVaultNamed}
      />
      <ShareInSheet />
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
      ) : null}
      <RowActions />
      {screen.kind === "file" && historyPath ? (
        <HistorySheet
          filePath={historyPath}
          open={overlay?.kind === "history"}
          onOpenChange={closeHistorySheet}
        />
      ) : null}
      <AssistantSheet
        open={overlay?.kind === "assistant"}
        onOpenChange={closeAssistant}
      />
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

/**
 * Keeps history and the assistant in step with Back: they're open while
 * their sheet or what it opened is, and a restored version or a settled
 * change closes the screen that showed it.
 */
function useSheetsFollowNav() {
  const entries = usePhoneNav((s) => s.entries);
  const has = (kind: string) => entries.some((entry) => entry.kind === kind);
  const historyOpen = has("history");
  const versionOpen = has("version");
  const assistantOpen = has("assistant") || has("change");
  const changeOpen = has("change");
  const picked = useHistoryStore((s) => s.picked);
  const change = usePreviewedChange();

  useEffect(() => {
    const history = useHistoryStore.getState();
    if (!historyOpen && history.openIn !== null) history.closeHistory();
    else if (historyOpen && !versionOpen && history.picked)
      history.pickVersion(null);
  }, [historyOpen, versionOpen]);

  // Restored: back to the shard, where a toast says so.
  useEffect(() => {
    if (versionOpen && picked === null)
      usePhoneNav.getState().closeFrom("history");
  }, [versionOpen, picked]);

  useEffect(() => {
    useAssistantStore.getState().setOpen(assistantOpen);
  }, [assistantOpen]);

  // Applied or discarded: back to the chat.
  useEffect(() => {
    if (changeOpen && change === null)
      usePhoneNav.getState().closeFrom("change");
  }, [changeOpen, change]);
}
