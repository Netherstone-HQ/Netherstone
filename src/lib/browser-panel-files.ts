import { useUIStore } from "@/store/ui";

/** Files a webview shows as a page: documents, pictures, text, sound, video. */
const BROWSER_PANEL_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "bmp",
  "ico",
  "svg",
  "txt",
  "log",
  "csv",
  "json",
  "mp3",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "flac",
  "mp4",
  "m4v",
  "webm",
  "ogv",
]);

function extensionOf(path: string) {
  const name = path.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Whether the browser panel can show the file at `path`. */
export function canShowInBrowserPanel(path: string | null | undefined) {
  return !!path && BROWSER_PANEL_EXTENSIONS.has(extensionOf(path));
}

/**
 * A `file:` URL for an absolute path on Windows (`C:\…`, `\\server\…`),
 * macOS or Linux.
 */
export function fileUrlFromPath(path: string) {
  const slashed = path.replace(/\\/g, "/");
  const encode = (segments: string[]) =>
    segments.map(encodeURIComponent).join("/");

  if (slashed.startsWith("//")) {
    const [host, ...rest] = slashed.slice(2).split("/");
    return `file://${host}/${encode(rest)}`;
  }

  const drive = /^([a-zA-Z]:)\/(.*)$/.exec(slashed);
  if (drive) return `file:///${drive[1]}/${encode(drive[2].split("/"))}`;

  return `file://${encode(slashed.split("/"))}`;
}

/** Shows a file from this computer in the browser panel. */
export function openFileInBrowserPanel(path: string) {
  useUIStore.getState().openInBrowserPanel(fileUrlFromPath(path));
}
