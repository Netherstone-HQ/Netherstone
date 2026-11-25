import { KEYS, type TElement } from "platejs";
import { create } from "zustand";
import { managedMediaNode, mediaNodeTypeForMime } from "@/components/editor/lib/media-insert";
import { flushPendingAutosave } from "@/hooks/useAutosave";
import { notifyAttachmentSyncStatus } from "@/lib/attachment-sync-status";
import type { PersistedAttachment } from "@/lib/commands/attachments";
import { saveSharedFile, takeShared, type Shared, type SharedFile } from "@/lib/commands/incoming";
import { appendMarkdownToFile } from "@/lib/commands/shards";
import { openEditorFile } from "@/lib/open-editor-file";
import { refreshVault } from "@/lib/refresh-vault";
import { useEditorStore } from "@/store";
import { createTitledShard, markdownOf, today } from "./create";
import { usePhoneNav } from "./nav";
import { siteOf } from "@/lib/open-web-link";

/** Sent by Android's MainActivity when another app shared something with this one. */
const SHARED_EVENT = "shared";

/** The longest title a shard made from shared text gets, in characters. */
const MAX_TITLE_LENGTH = 60;

/** A link that was shared: where it goes, what it's called and its site. */
interface SharedLink {
  url: string;
  title: string;
  site: string;
}

/** What came in, as the sheet shows it and the shard holds it. */
export interface ShareContent {
  link: SharedLink | null;
  /** Shared text that isn't just a link. */
  text: string | null;
  files: SharedFile[];
}

/** The share showing in its sheet, waiting to be saved or not. */
export const useShareIn = create<{ shared: Shared | null; id: number }>(() => ({
  shared: null,
  id: 0,
}));

/**
 * Takes the latest share from another app and shows it in its sheet, in
 * place of one still showing.
 */
async function takeShareIn() {
  const shared = await takeShared();
  if (!shared) return;
  useShareIn.setState((state) => ({ shared, id: state.id + 1 }));
  const nav = usePhoneNav.getState();
  if (!nav.entries.some((entry) => entry.kind === "share-in")) nav.push({ kind: "share-in" });
}

/**
 * Shows what other apps share with Netherstone: what came while the app
 * started, then each new share.
 */
export function followShares() {
  const take = () =>
    void takeShareIn().catch((error) =>
      console.error("[Netherstone] Couldn't take what was shared:", error),
    );
  window.addEventListener(SHARED_EVENT, take);
  take();
  return () => window.removeEventListener(SHARED_EVENT, take);
}

const URL_PATTERN = /https?:\/\/[^\s<>"]+/g;

/**
 * What a share is. Text holding one link and at most a line besides, as
 * browsers and most apps share a page, is that link, called by the share's
 * subject, that line or its site. Any other text is text.
 */
export function shareContent(shared: Shared): ShareContent {
  const text = shared.text?.trim() ?? "";
  const urls = text.match(URL_PATTERN) ?? [];
  const rest = text.replace(URL_PATTERN, "").trim();
  if (urls.length === 1 && !rest.includes("\n")) {
    const url = urls[0];
    const title = shared.subject?.trim() || rest || siteOf(url);
    return { link: { url, title, site: siteOf(url) }, text: null, files: shared.files };
  }
  return { link: null, text: text || null, files: shared.files };
}

/** `text` made fit for a shard's name: no characters a file name can't hold. */
function asTitle(text: string) {
  const name = text
    .replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "");
  if (name.length <= MAX_TITLE_LENGTH) return name;
  const cut = name.slice(0, MAX_TITLE_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * The title of a new shard made from `content`: the link's title, the
 * text's first line, the one file's name, or "Shared, 24 Nov".
 */
export function shareTitle(content: ShareContent) {
  const fileStem = (name: string) => name.replace(/\.[^.]+$/, "");
  const from =
    content.link?.title ??
    content.text?.split("\n")[0] ??
    (content.files.length === 1 ? fileStem(content.files[0].name) : "");
  return asTitle(from) || `Shared, ${today()}`;
}

/** The blocks `content` becomes, its files copied into the vault. */
async function blocksOf(content: ShareContent, vaultPath: string) {
  const blocks: TElement[] = [];
  if (content.link) {
    blocks.push({
      type: KEYS.p,
      children: [
        {
          type: KEYS.link,
          url: content.link.url,
          children: [{ text: content.link.title }],
        },
      ],
    });
  }
  for (const line of content.text?.split("\n") ?? []) {
    blocks.push({ type: KEYS.p, children: [{ text: line }] });
  }
  const saved: PersistedAttachment[] = [];
  for (const file of content.files) {
    const persisted = await saveSharedFile(file.path, vaultPath);
    saved.push(persisted);
    blocks.push(managedMediaNode(persisted, mediaNodeTypeForMime(file.type), file.name));
  }
  return { blocks, saved };
}

/** Where a share goes: a new shard in a folder, or the end of a shard. */
export type ShareTarget =
  | { kind: "new"; folder: string }
  | { kind: "add"; shard: string };

/**
 * Saves `content` where `target` says and returns the shard it's in. Its
 * files are copied into the vault first.
 */
export async function saveShare(
  content: ShareContent,
  target: ShareTarget,
  vaultPath: string,
): Promise<string> {
  const { blocks, saved } = await blocksOf(content, vaultPath);
  let shard: string;
  if (target.kind === "new") {
    shard = await createTitledShard(target.folder, shareTitle(content), blocks);
  } else {
    shard = target.shard;
    // The open shard's edits are saved first, so they're kept.
    await flushPendingAutosave();
    await appendMarkdownToFile(shard, markdownOf(blocks, shard));
    // An open shard is read again, so it shows what was added.
    if (useEditorStore.getState().currentFilePath === shard) await openEditorFile(shard);
  }
  notifyAttachmentSyncStatus(saved);
  await refreshVault(vaultPath);
  return shard;
}
