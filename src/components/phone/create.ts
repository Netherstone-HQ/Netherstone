import { KEYS, createSlateEditor, type TElement } from "platejs";
import { managedMediaNode } from "@/components/editor/lib/media-insert";
import { SerializationKit } from "@/components/editor/serialization-kit";
import { notifyAttachmentSyncStatus } from "@/lib/attachment-sync-status";
import {
  fileExists,
  persistAttachmentBytes,
} from "@/lib/commands/attachments";
import { serializeEditorMarkdown } from "@/lib/editor-markdown";
import { createDrawing } from "@/lib/open-vault-file";
import {
  appendMarkdownToFile,
  createFolder,
  createShardFile,
  renameFile,
} from "@/lib/commands/shards";
import { isSamePath } from "@/lib/drawing-files";
import { pickFiles } from "@/lib/pick-files";
import { startVoiceNote } from "@/lib/voice/voice-note";
import type { PlateEditor } from "platejs/react";
import { createEmptyVault, vaultErrorText } from "@/components/onboarding/create-vault";
import { defaultVaultLocation, scanVault } from "@/lib/commands/vault";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { joinPath, openVault } from "@/lib/open-vault";
import { refreshVault } from "@/lib/refresh-vault";
import { useEditorStore, useVaultStore } from "@/store";
import { errorText } from "@/lib/utils";
import { openFileScreen } from "./open-file";
import { usePhoneNav } from "./nav";
import { reportFailure } from "./toasts";

async function refreshTree(vaultPath: string) {
  useVaultStore.getState().setFileTree(await scanVault(vaultPath));
}

/** Makes an empty "Untitled" shard in `folder` and opens it. */
export async function createUntitledShard(vaultPath: string, folder: string) {
  let filePath: string;
  try {
    filePath = await createShardFile(folder);
  } catch (error) {
    reportFailure("Couldn't make the shard", error);
    return;
  }
  await openFileScreen(filePath);
  await refreshVault(vaultPath);
}

/** Makes the folder `name` in `parent` and opens it in place of the sheet. */
export async function createFolderIn(
  vaultPath: string,
  parent: string,
  name: string,
): Promise<string | null> {
  try {
    const path = await createFolder(parent, name);
    await refreshTree(vaultPath);
    usePhoneNav.getState().replace({ kind: "folder", path });
    return null;
  } catch (error) {
    return errorText(error);
  }
}

/** Today as a shard's title says it: "24 Nov". */
export function today() {
  return new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

/** `title`, or "`title` 2" and so on, whichever is free in `folder`. */
async function freeTitle(folder: string, title: string) {
  for (let count = 1; ; count += 1) {
    const candidate = count === 1 ? title : `${title} ${count}`;
    if (!(await fileExists(joinPath(folder, `${candidate}.md`))))
      return candidate;
  }
}

/** `blocks` as Markdown for the shard at `filePath`. */
export function markdownOf(blocks: TElement[], filePath: string) {
  const editor = createSlateEditor({ plugins: SerializationKit, value: blocks });
  return serializeEditorMarkdown(editor, { filePath });
}

/** Makes a shard called `title` ("… 2" when taken) holding `body`, and returns its path. */
export async function createTitledShard(folder: string, title: string, body: TElement[]) {
  const name = await freeTitle(folder, title);
  const filePath = await renameFile(await createShardFile(folder), name);
  await appendMarkdownToFile(
    filePath,
    markdownOf([{ type: KEYS.h1, children: [{ text: name }] }, ...body], filePath),
  );
  return filePath;
}

/** A shard called `base` and today's date, as in "Photo, 24 Nov". */
function createDatedShard(folder: string, base: string, body: TElement[]) {
  return createTitledShard(folder, `${base}, ${today()}`, body);
}

/** Takes a picture and opens it in a new "Photo, 24 Nov" shard. */
export async function createPhotoShard(vaultPath: string, folder: string) {
  const [photo] = await pickFiles("image", { camera: true });
  if (!photo) return;
  let filePath: string;
  try {
    const persisted = await persistAttachmentBytes(
      photo.name,
      new Uint8Array(await photo.arrayBuffer()),
      vaultPath,
    );
    filePath = await createDatedShard(folder, "Photo", [
      managedMediaNode(persisted, KEYS.img, photo.name),
    ]);
    notifyAttachmentSyncStatus([persisted]);
  } catch (error) {
    reportFailure("Couldn't save the photo", error);
    return;
  }
  await openFileScreen(filePath);
  await refreshVault(vaultPath);
}

/** The editor once it shows `filePath`, or null when another file opens first. */
function editorShowing(filePath: string): Promise<PlateEditor | null> {
  const showing = (state: ReturnType<typeof useEditorStore.getState>) =>
    state.plateEditor &&
    state.currentFilePath &&
    isSamePath(state.currentFilePath, filePath)
      ? (state.plateEditor as PlateEditor)
      : null;
  return new Promise((resolve) => {
    const now = showing(useEditorStore.getState());
    if (now) return resolve(now);
    const stop = useEditorStore.subscribe((state) => {
      const opening = state.openingFilePath ?? state.currentFilePath;
      const editor = showing(state);
      if (editor || !opening || !isSamePath(opening, filePath)) {
        stop();
        resolve(editor);
      }
    });
  });
}

/** Opens a new "Voice note, 24 Nov" shard and starts recording in it. */
export async function createVoiceNoteShard(vaultPath: string, folder: string) {
  let filePath: string;
  try {
    filePath = await createDatedShard(folder, "Voice note", []);
  } catch (error) {
    reportFailure("Couldn't make the shard", error);
    return;
  }
  await openFileScreen(filePath);
  const editor = await editorShowing(filePath);
  if (editor) await startVoiceNote(editor);
  await refreshVault(vaultPath);
}
/** Makes an untitled drawing in `folder` and opens it. */
export async function createDrawingIn(vaultPath: string, folder: string) {
  const path = await createDrawing(vaultPath, folder);
  if (path) usePhoneNav.getState().push({ kind: "file", path });
}

/** Makes the vault `name` and opens its Start here guide. Returns the error, or null. */
export async function createVaultNamed(name: string): Promise<string | null> {
  try {
    const location = await defaultVaultLocation();
    if (!location) return "Couldn't find where this phone keeps vaults.";
    const target = joinPath(location, name.trim());
    const chosen = await chooseVaultFolder(target, "create");
    if (chosen !== target) {
      // An existing vault there opens instead; nothing picked stays put.
      if (!chosen) return null;
      await openVault(chosen);
      usePhoneNav.getState().closeFrom("new-vault");
      return null;
    }
    const { startHerePath } = await createEmptyVault(location, name);
    if (startHerePath) await openFileScreen(startHerePath, true);
    else usePhoneNav.getState().closeFrom("new-vault");
    return null;
  } catch (error) {
    return vaultErrorText(error);
  }
}
