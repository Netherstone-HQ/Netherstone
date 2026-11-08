import { Channel, invoke } from "@tauri-apps/api/core";
import { assertTauri } from "./tauri";

/** What a Netherstone link opens, before anything downloads. */
export interface LinkListing {
  template: boolean;
  name: string;
  /** As people see it: `github.com/lena-k/field-guide`. */
  address: string;
  files: number;
  shards: number;
  drawings: number;
  pictures: number;
  /** Other files there, which aren't downloaded. */
  leftOut: number;
  /** Bytes the vault takes. */
  size: number;
}

/** Why a link couldn't be opened, as `open_source.rs` names it. */
export type LinkRefusal =
  | { code: "update-first"; name: string | null; version: string | null }
  | { code: "template-not-found" }
  | { code: "cant-open" }
  | { code: "nothing-to-open" }
  | { code: "too-many-files" }
  | { code: "not-enough-space"; needed: number; free: number; folder: string }
  | { code: "download-failed" }
  | { code: "cancelled" }
  | { code: "vault"; error: string };

export interface LinkProgress {
  stage: "template" | "shards" | "drawings" | "pictures";
  /** Files of this stage downloaded, of `total`. */
  done: number;
  total: number;
  /** Bytes downloaded, of every stage. */
  bytes: number;
  totalBytes: number;
}

/** What Create vault made from a link. */
export interface LinkCreated {
  vault: string;
  /** A template's first shard, to open. */
  firstShard: string | null;
  /** Any other folder's files, for the Markdown import. */
  sources: { path: string; relativePath: string; size: number }[];
}

/** Lists what the link Rust handed over opens. */
export async function listLink(address: string): Promise<LinkListing> {
  assertTauri();
  return invoke<LinkListing>("open_link_list", { address });
}

/** Downloads what the link opens and makes the vault `parent/name` from it. */
export async function createFromLink(
  address: string,
  parent: string,
  name: string,
  onProgress: (progress: LinkProgress) => void,
): Promise<LinkCreated> {
  assertTauri();
  const progress = new Channel<LinkProgress>();
  progress.onmessage = onProgress;
  return invoke<LinkCreated>("open_link_create", { address, parent, name, progress });
}

/** Stops the link's download; what came so far is removed. */
export async function cancelLink(): Promise<void> {
  assertTauri();
  return invoke("open_link_cancel");
}

/** Done with the link: removes its downloads. */
export async function finishLink(): Promise<void> {
  assertTauri();
  return invoke("open_link_done");
}
