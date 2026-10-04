export type PersistedMediaSourceKind =
  | "blob"
  | "data"
  | "local"
  | "remote"
  | "unknown"
  | "vault";

export type PersistedMediaText = {
  text?: string;
  [key: string]: unknown;
};

export interface PersistedMediaMetadata {
  netherstoneImportedPath?: string;
  netherstoneInsertionMethod?: string;
  netherstoneMissing?: boolean;
  netherstoneExtension?: string;
  netherstoneOriginalPath?: string;
  netherstoneRenderUrl?: string;
  netherstoneSourceKind?: PersistedMediaSourceKind;
  netherstoneStoredSource?: string;
  netherstoneSyncStatus?:
    | "syncable"
    | "local_only"
    | "blocked"
    | "pending_review";
  netherstoneShardPath?: string;
  netherstoneSizeBytes?: number;
  netherstoneVaultPath?: string;
}

export interface PersistedMediaElementBase extends PersistedMediaMetadata {
  children: unknown[];
  type: string;
  name?: string;
  url?: string;
}

export type WithPersistedMediaMetadata<T extends object> = T &
  PersistedMediaMetadata;
