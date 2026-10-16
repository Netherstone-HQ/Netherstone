import type { TextPart } from "@/components/HighlightedText";

export type DocumentLinkKind =
  | "shard-mention"
  | "internal"
  | "external"
  | "email"
  | "phone"
  | "anchor"
  | "other";

export interface DocumentLink {
  label: string;
  target: string;
  kind: DocumentLinkKind;
  /** False for a link to a shard that doesn't exist. */
  isValid: boolean;
  /** The linked shard, for links to shards. */
  resolvedPath: string | null;
}

/** A shard's indexed details. */
export interface FileMetadata {
  /** Seconds since the epoch. */
  created_at: number;
  /** Seconds since the epoch. */
  last_modified: number;
  word_count: number;
  character_count: number;
  /** In bytes. */
  file_size: number;
  /** Alphabetical. */
  tags: string[];
}

/** A shard that links to the open one. */
export interface Backlink {
  path: string;
  name: string;
  /** The text around its first link to the open shard, highlighted. */
  excerpt: TextPart[] | null;
}
