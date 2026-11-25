import { KEYS, createSlateEditor, type TElement } from "platejs";
import { toast } from "sonner";
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
import {
  createEmptyVault,
  vaultErrorText,
} from "@/components/onboarding/VaultStep";
import { defaultVaultLocation, scanVault } from "@/lib/commands/vault";
import { chooseVaultFolder } from "@/lib/nested-vault";
import { joinPath, openVault } from "@/lib/open-vault";
import { indexVault } from "@/lib/refresh-vault";
import { useEditorStore, useVaultStore } from "@/store";
import { openFileScreen } from "./open-file";
import { usePhoneNav } from "./nav";

async function refreshTree(vaultPath: string) {
  useVaultStore.getState().setFileTree(await scanVault(vaultPath));
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Makes an empty shard in `folder`, called "Untitled", or "Untitled 2" and
 * so on when that's taken, and opens it to type in.
 */
export async function createUntitledShard(vaultPath: string, folder: string) {
  let filePath: string;
  try {
    filePath = await createShardFile(folder);
  } catch (error) {
    toast.error("Couldn't make the shard", { description: message(error) });
    return;
  }
  await openFileScreen(filePath);
  await refreshTree(vaultPath);
  await indexVault(vaultPath);
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
    return message(error);
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
export async function freeTitle(folder: string, title: string) {
  for (let count = 1; ; count += 1) {
    const candidate = count === 1 ? title : `${title} ${count}`;
    if (!(await fileExists(joinPath(folder, `${candidate}.md`))))
      return candidate;
  }
}

/**
 * Makes a shard in `folder` called `base` and today's date ("Photo, 24
 * Nov", or "… 2" when that's taken), with that title and then `body`.
 * Returns its path.
 */
async function createDatedShard(folder: string, base: string, body: TElement[]) {
  const title = await freeTitle(folder, `${base}, ${today()}`);
  const filePath = await renameFile(await createShardFile(folder), title);
  const editor = createSlateEditor({
    plugins: SerializationKit,
    value: [{ type: KEYS.h1, children: [{ text: title }] }, ...body],
  });
  await appendMarkdownToFile(filePath, serializeEditorMarkdown(editor, { filePath }));
  return filePath;
}

/**
 * Takes a picture with the camera app and makes a shard of it in `folder`,
 * titled with today's date ("Photo, 24 Nov"), then opens it. Nothing is
 * made when the camera is closed without a picture.
 */
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
    toast.error("Couldn't save the photo", { description: message(error) });
    return;
  }
  await openFileScreen(filePath);
  await refreshTree(vaultPath);
  await indexVault(vaultPath);
}

/**
 * The shard's editor once it shows `filePath`, or null when another file
 * opens first.
 */
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

/**
 * Makes a shard in `folder` titled with today's date ("Voice note, 24 Nov"),
 * opens it and starts recording a voice note in it.
 */
export async function createVoiceNoteShard(vaultPath: string, folder: string) {
  let filePath: string;
  try {
    filePath = await createDatedShard(folder, "Voice note", []);
  } catch (error) {
    toast.error("Couldn't make the shard", { description: message(error) });
    return;
  }
  await openFileScreen(filePath);
  const editor = await editorShowing(filePath);
  if (editor) await startVoiceNote(editor);
  await refreshTree(vaultPath);
  await indexVault(vaultPath);
}
/** Makes an untitled drawing in `folder` and opens it. */
export async function createDrawingIn(vaultPath: string, folder: string) {
  const path = await createDrawing(vaultPath, folder);
  if (path) usePhoneNav.getState().push({ kind: "file", path });
}

/**
 * Makes the vault `name` on this phone, switches to it and opens its Start
 * here guide in place of the sheet that asked. Returns what went wrong, or
 * null.
 */
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
