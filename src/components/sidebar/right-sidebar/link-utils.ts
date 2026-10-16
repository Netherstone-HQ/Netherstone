import { KEYS } from "platejs";

import type { FileTreeNode } from "@/store";
import { getVaultFileDisplayName, isMarkdownPath } from "@/lib/drawing-files";
import type { DocumentLink, DocumentLinkKind } from "./types";

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

function normalizePath(path: string) {
  return path.replace(/\\/g, "/");
}

/**
 * Decodes a percent-encoded link target (`My%20note.md` is `My note.md`).
 * A target that isn't valid percent-encoding, like `100% done.md`, is kept
 * as written.
 */
function decodeLinkTarget(target: string) {
  try {
    return decodeURIComponent(target);
  } catch {
    return target;
  }
}

/** The path a link points to, without its `#heading` or `?query`, decoded. */
export function stripLinkDecorators(target: string) {
  return decodeLinkTarget(target.split("#")[0]?.split("?")[0]?.trim() ?? "");
}

function removeMarkdownExtension(value: string) {
  return value.replace(/\.md$/i, "");
}

function classifyLinkTarget(target: string): DocumentLinkKind {
  if (target.startsWith("#")) return "anchor";
  if (/^mailto:/i.test(target)) return "email";
  if (/^tel:/i.test(target)) return "phone";
  if (/^(https?:|ftp:|file:|data:|blob:|asset:)/i.test(target)) {
    return "external";
  }
  if (target.length > 0) return "internal";
  return "other";
}

function getNodeText(node: unknown): string {
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

interface ExtractedDocumentLink {
  label: string;
  target: string;
  kind: DocumentLinkKind;
}

function extractDocumentLinksFromValue(
  value: unknown,
): ExtractedDocumentLink[] {
  const links: ExtractedDocumentLink[] = [];

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;

    const record = node as Record<string, unknown>;

    if (record.type === KEYS.mention && typeof record.value === "string") {
      const shardName = record.value.trim();

      if (shardName) {
        links.push({
          label: shardName,
          target: shardName,
          kind: "shard-mention",
        });
      }
    }

    const target = typeof record.url === "string" ? record.url.trim() : "";

    if (record.type === KEYS.link && target) {
      const label = Array.isArray(record.children)
        ? record.children.map(getNodeText).join("").trim()
        : "";

      links.push({
        label: label || target,
        target,
        kind: classifyLinkTarget(target),
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

/**
 * The links in a shard's editor `value`, each once, in order. Mentions are
 * resolved against the vault's shards and links to files against all of
 * `vaultFiles`; the ones that can't be are invalid.
 */
export function resolveDocumentLinks(
  value: unknown,
  currentFilePath: string,
  currentVaultPath: string,
  vaultFiles: FileTreeNode[],
): DocumentLink[] {
  const links = new Map<string, DocumentLink>();
  const shardFiles = vaultFiles.filter((file) => isMarkdownPath(file.path));

  for (const link of extractDocumentLinksFromValue(value)) {
    const resolvedPath =
      link.kind === "shard-mention"
        ? resolveShardReferencePath(link.target, shardFiles)
        : link.kind === "internal"
          ? resolveInternalTargetPath(
              link.target,
              currentFilePath,
              currentVaultPath,
              vaultFiles,
            )
          : null;
    const isShard = link.kind === "shard-mention" || link.kind === "internal";
    const key = isShard
      ? (resolvedPath ?? `missing:${link.target}`)
      : `${link.kind}:${link.target}`;

    if (!links.has(key)) {
      links.set(key, {
        ...link,
        isValid: !isShard || resolvedPath !== null,
        resolvedPath,
      });
    }
  }

  return [...links.values()];
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

/**
 * What a link is called in the Links list: the shard's name, the website's
 * address without `www.`, or the email address or phone number.
 */
export function getLinkName(link: DocumentLink) {
  if (link.resolvedPath) {
    return getVaultFileDisplayName(
      normalizePath(link.resolvedPath).split("/").pop() ?? link.label,
    );
  }

  switch (link.kind) {
    case "external":
      try {
        return (
          new URL(link.target).hostname.replace(/^www\./, "") || link.label
        );
      } catch {
        return link.label;
      }
    case "email":
      return link.target.replace(/^mailto:/i, "");
    case "phone":
      return link.target.replace(/^tel:/i, "");
    default:
      return link.label;
  }
}

/** Every file in the tree. */
export function flattenFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  const files: FileTreeNode[] = [];

  const visit = (node: FileTreeNode) => {
    if (node.kind === "file") {
      files.push(node);
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

/** Every shard in the tree. */
export function flattenShardFiles(nodes: FileTreeNode[]): FileTreeNode[] {
  return flattenFiles(nodes).filter((file) => isMarkdownPath(file.path));
}

function normalizePathSegments(path: string) {
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
  files: FileTreeNode[],
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

  for (const file of files) {
    const filePath = normalizePath(file.path);
    if (candidatePaths.has(filePath)) {
      return file.path;
    }
  }

  const lastSegment = cleanedTarget.split("/").pop() ?? cleanedTarget;
  const normalizedName = removeMarkdownExtension(lastSegment).toLowerCase();
  const nameMatches = files.filter(
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
