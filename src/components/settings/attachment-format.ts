/** Formatting shared by the attachment settings rows. */

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/** Short label for an asset; content-hash names keep 8 characters. */
export function getAssetLabel(assetPath: string) {
  const name = getFileName(assetPath);
  const match = /^([0-9a-f]{64})(\.[^.]+)?$/i.exec(name);
  return match ? `${match[1].slice(0, 8)}…${match[2] ?? ""}` : name;
}
