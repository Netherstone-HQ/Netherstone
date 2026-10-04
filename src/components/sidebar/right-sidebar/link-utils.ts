import type { FileTreeNode } from "@/store";
import { isMarkdownPath } from "@/lib/drawing-files";
import type {
  DocumentLink,
  DocumentLinkKind,
  ExtractedDocumentLink,
  FileMetadata,
  LinkSection,
  MetadataRow,
} from "./types";

export const LINK_VALIDATION_DEBOUNCE_MS = 450;
export const METADATA_REFRESH_DEBOUNCE_MS = 300;
export const METADATA_WATCHER_SUPPRESS_AFTER_SAVE_MS = 1500;
const MAX_LINKS = 100;

export function formatTimestamp(timestamp: number) {
  if (!timestamp) return "—";

  const date = new Date(timestamp * 1000);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const fractionDigits =
    unitIndex === 0 ? 0 : size >= 100 ? 0 : size >= 10 ? 1 : 2;

  return `${size.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

export function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

export function stripLinkDecorators(target: string) {
  return target.split("#")[0]?.split("?")[0]?.trim() ?? "";
}

export function removeMarkdownExtension(value: string) {
  return value.replace(/\.md$/i, "");
}

export function isExternalUrl(target: string) {
  return /^(https?:|ftp:|file:|data:|blob:|asset:)/i.test(target);
}

export function classifyLinkTarget(target: string): DocumentLinkKind {
  if (target.startsWith("#")) return "anchor";
  if (/^mailto:/i.test(target)) return "email";
  if (/^tel:/i.test(target)) return "phone";
  if (isExternalUrl(target)) return "external";
  if (target.length > 0) return "internal";
  return "other";
}

export function getNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";

  const record = node as Record<string, unknown>;

  if (typeof record.text === "string") {
    return record.text;
  }

  if (!Array.isArray(record.children)) {
    return "";
  }

  return record.children.map(getNodeText).join("");
}

export function extractDocumentLinksFromValue(
  value: unknown,
): ExtractedDocumentLink[] {
  const links: ExtractedDocumentLink[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;

    if (record.type === "mention" && typeof record.value === "string") {
      const shardName = record.value.trim();

      if (shardName) {
        links.push({
          label: `@${shardName}`,
          target: shardName,
          kind: "shard-mention",
        });
      }
    }

    const target = typeof record.url === "string" ? record.url.trim() : "";

    if (record.type === "link" && target) {
      const label = Array.isArray(record.children)
        ? record.children.map(getNodeText).join("").trim()
        : "";

      const kind = classifyLinkTarget(target);

      links.push({
        label: label || target,
        target,
        kind,
      });
    }

    if (Array.isArray(record.children)) {
      for (const child of record.children) {
        visit(child);
      }
    }
  };

  if (Array.isArray(value)) {
    for (const node of value) {
      visit(node);
    }
  }

  return links.slice(0, MAX_LINKS);
}

export function areDocumentLinksEqual(
  a: DocumentLink[],
  b: DocumentLink[],
): boolean {
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];

    if (
      left.label !== right.label ||
      left.target !== right.target ||
      left.kind !== right.kind ||
      left.isValid !== right.isValid ||
      left.resolvedPath !== right.resolvedPath
    ) {
      return false;
    }
  }

  return true;
}

export function flattenShardFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  const files: FileTreeNode[] = [];

  const visit = (node: FileTreeNode) => {
    if (node.kind === "file") {
      if (isMarkdownPath(node.path)) files.push(node);
      return;
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  for (const node of nodes) {
    visit(node);
  }

  return files;
}

export function normalizePathSegments(path: string) {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  const resolved: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === ".") continue;

    if (segment === "..") {
      if (
        resolved.length > 1 ||
        (resolved.length === 1 && !resolved[0].endsWith(":"))
      ) {
        resolved.pop();
      }
      continue;
    }

    resolved.push(segment);
  }

  return resolved.join("/");
}

export function resolveInternalTargetPath(
  target: string,
  currentFilePath: string,
  currentVaultPath: string,
  shardFiles: FileTreeNode[],
) {
  const cleanedTarget = stripLinkDecorators(target);

  if (!cleanedTarget) return null;

  const normalizedVaultPath = normalizePath(currentVaultPath);
  const normalizedCurrentPath = normalizePath(currentFilePath);
  const lastSlashIndex = normalizedCurrentPath.lastIndexOf("/");
  const currentDir =
    lastSlashIndex >= 0
      ? normalizedCurrentPath.slice(0, lastSlashIndex)
      : normalizedCurrentPath;

  const resolvedBase = cleanedTarget.startsWith("/")
    ? `${normalizedVaultPath}/${cleanedTarget.replace(/^\/+/, "")}`
    : `${currentDir}/${cleanedTarget}`;

  const normalizedBase = normalizePathSegments(resolvedBase);
  const candidatePaths = new Set<string>([normalizedBase]);

  if (!/\.md$/i.test(normalizedBase)) {
    candidatePaths.add(`${normalizedBase}.md`);
  }

  for (const file of shardFiles) {
    const filePath = normalizePath(file.path);
    if (candidatePaths.has(filePath)) {
      return file.path;
    }
  }

  const lastSegment = cleanedTarget.split("/").pop() ?? cleanedTarget;
  const normalizedName = removeMarkdownExtension(lastSegment).toLowerCase();
  const nameMatches = shardFiles.filter(
    (file) =>
      removeMarkdownExtension(file.name).toLowerCase() === normalizedName,
  );

  if (nameMatches.length === 1) {
    return nameMatches[0].path;
  }

  return null;
}

export function resolveShardReferencePath(
  target: string,
  shardFiles: FileTreeNode[],
) {
  const cleanedTarget = stripLinkDecorators(target);
  if (!cleanedTarget) return null;

  const normalizedTarget = normalizePath(cleanedTarget).toLowerCase();
  const targetBaseName = removeMarkdownExtension(
    cleanedTarget.split("/").pop() ?? cleanedTarget,
  ).toLowerCase();

  const exactPathMatch = shardFiles.find((file) => {
    const filePath = normalizePath(file.path).toLowerCase();
    return (
      filePath === normalizedTarget ||
      filePath.endsWith(`/${normalizedTarget}`) ||
      removeMarkdownExtension(filePath) === normalizedTarget ||
      removeMarkdownExtension(filePath).endsWith(
        `/${removeMarkdownExtension(normalizedTarget)}`,
      )
    );
  });

  if (exactPathMatch) {
    return exactPathMatch.path;
  }

  const nameMatches = shardFiles.filter(
    (file) =>
      removeMarkdownExtension(file.name).toLowerCase() === targetBaseName,
  );

  if (nameMatches.length === 1) {
    return nameMatches[0].path;
  }

  return null;
}

export function getLinkSectionTitle(kind: DocumentLinkKind) {
  switch (kind) {
    case "shard-mention":
      return "Shard References";
    case "internal":
      return "Document Links";
    case "external":
      return "External Links";
    case "email":
      return "Email Links";
    case "phone":
      return "Phone Links";
    case "anchor":
      return "In-Document Anchors";
    default:
      return "Other Links";
  }
}

export function getLinkTargetDisplay(link: DocumentLink) {
  if (link.kind === "shard-mention") {
    return link.isValid ? "" : "Unresolved shard reference";
  }

  if (link.kind === "internal") {
    return `→ ${link.target}`;
  }

  return link.target;
}

export function buildLinkSections(
  documentLinks: DocumentLink[],
): LinkSection[] {
  const sectionOrder: DocumentLinkKind[] = [
    "shard-mention",
    "internal",
    "external",
    "email",
    "phone",
    "anchor",
    "other",
  ];

  return sectionOrder
    .map((kind) => ({
      kind,
      title: getLinkSectionTitle(kind),
      links: documentLinks.filter((link) => link.kind === kind),
    }))
    .filter((section) => section.links.length > 0);
}

export function buildMetadataRows(
  fileMetadata: FileMetadata | null,
): MetadataRow[] {
  if (!fileMetadata) return [];

  return [
    { label: "Created", value: formatTimestamp(fileMetadata.created_at) },
    {
      label: "Last Modified",
      value: formatTimestamp(fileMetadata.last_modified),
    },
    {
      label: "Last Indexed",
      value: formatTimestamp(fileMetadata.last_indexed),
    },
    {
      label: "Words",
      value: fileMetadata.word_count.toLocaleString(),
    },
    {
      label: "Lines",
      value: fileMetadata.line_count.toLocaleString(),
    },
    {
      label: "Characters",
      value: fileMetadata.character_count.toLocaleString(),
    },
    {
      label: "File Size",
      value: formatFileSize(fileMetadata.file_size),
    },
    {
      label: "Outbound Links",
      value: fileMetadata.outbound_link_count.toLocaleString(),
    },
    {
      label: "Tags",
      value: fileMetadata.tag_count.toLocaleString(),
    },
  ];
}
