import { stripLinkDecorators } from "@/components/sidebar/right-sidebar/link-utils";
import { openEditorFile } from "@/lib/open-editor-file";
import { isWebPageUrl, openWebLink } from "@/lib/open-web-link";
import type { LinkOpener } from "@/store/settings";

export function isExternalLink(href: string) {
  return (
    /^(https?:|mailto:|tel:|ftp:|file:|data:|blob:|asset:)/i.test(href) ||
    /^https?:\/\/(?:asset|file)\.localhost\//i.test(href)
  );
}

export function resolveInternalLinkPath(
  currentFilePath: string,
  href: string,
): string | null {
  const cleanedHref = stripLinkDecorators(href);

  if (
    !cleanedHref ||
    cleanedHref.startsWith("#") ||
    cleanedHref.startsWith("/") ||
    isExternalLink(cleanedHref)
  ) {
    return null;
  }

  const normalizedCurrentPath = currentFilePath.replace(/\\/g, "/");
  const lastSlashIndex = normalizedCurrentPath.lastIndexOf("/");
  const baseDir =
    lastSlashIndex >= 0
      ? normalizedCurrentPath.slice(0, lastSlashIndex)
      : normalizedCurrentPath;

  const parts = `${baseDir}/${cleanedHref}`.split("/");
  const resolvedParts: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;

    if (part === "..") {
      if (
        resolvedParts.length > 1 ||
        (resolvedParts.length === 1 && !resolvedParts[0].endsWith(":"))
      ) {
        resolvedParts.pop();
      }
      continue;
    }

    resolvedParts.push(part);
  }

  return resolvedParts.join("/");
}

/**
 * Opens what a link in `currentFilePath` points to: a web page, an email or
 * phone app, or another file in the vault. False when there's nothing to open.
 */
export function openLinkTarget(
  href: string,
  currentFilePath: string,
  openIn?: LinkOpener,
): boolean {
  if (isWebPageUrl(href) || /^(mailto|tel):/i.test(href)) {
    openWebLink(href, openIn).catch((error) => {
      console.error("Failed to open link:", href, error);
    });
    return true;
  }

  const path = resolveInternalLinkPath(currentFilePath, href);
  if (!path) return false;

  openEditorFile(path).catch((error) => {
    console.error("Failed to open linked file:", path, error);
  });
  return true;
}
