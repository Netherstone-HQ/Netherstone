import type { FileTreeNode } from "@/store";
import type { Heading } from "@platejs/toc";

export type DocumentLinkKind =
  | "shard-mention"
  | "internal"
  | "external"
  | "email"
  | "phone"
  | "anchor"
  | "other";

export interface ExtractedDocumentLink {
  label: string;
  target: string;
  kind: DocumentLinkKind;
}

export interface DocumentLink extends ExtractedDocumentLink {
  isValid: boolean;
  resolvedPath: string | null;
}

export interface FileMetadata {
  path: string;
  name: string;
  created_at: number;
  last_modified: number;
  last_indexed: number;
  word_count: number;
  line_count: number;
  character_count: number;
  file_size: number;
  outbound_link_count: number;
  tag_count: number;
}

export interface MetadataRow {
  label: string;
  value: string;
}

export interface LinkSection {
  kind: DocumentLinkKind;
  title: string;
  links: DocumentLink[];
}

export interface OutlineSectionProps {
  currentFilePath: string | null;
  plateEditor: any;
  tocHeadings: Heading[];
}

export interface DocumentLinksSectionProps {
  currentFilePath: string | null;
  isLoadingLinks: boolean;
  documentLinks: DocumentLink[];
  linkSections: LinkSection[];
  onOpenResolvedLink: (resolvedPath: string) => void;
}

export interface Backlink {
  path: string;
  name: string;
  snippet: string | null;
}

export interface BacklinksSectionProps {
  currentFilePath: string | null;
  isLoadingBacklinks: boolean;
  backlinks: Backlink[];
  onOpenResolvedLink: (resolvedPath: string) => void;
}

export interface MetadataSectionProps {
  currentFilePath: string | null;
  isLoadingMetadata: boolean;
  fileMetadata: FileMetadata | null;
  isDirty: boolean;
  metadataRows: MetadataRow[];
}

export type ShardFileNode = FileTreeNode;
