/**
 * Loads the images a shard shows, once per export, so every format embeds
 * the same pictures: attachments in the vault, files elsewhere on this
 * computer, images on the web and inline data URLs.
 */

import {
  getFilesystemPathFromMediaSource,
  isDataMediaSource,
  isRemoteMediaSource,
  normalizePathSlashes,
} from "@/lib/media-source";

import type { ExportImageRequest } from "./model";

export type ImageMime =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp"
  | "image/svg+xml"
  | "image/bmp"
  | "image/avif"
  | "image/tiff"
  | "image/x-icon";

export interface LoadedImage {
  bytes: Uint8Array;
  mime: ImageMime;
  /** Intrinsic size in CSS pixels. */
  width: number;
  height: number;
}

export type ImageMap = Map<string, LoadedImage>;

export interface AssetIO {
  readLocal: (path: string) => Promise<Uint8Array>;
  fetchRemote: (url: string) => Promise<Uint8Array>;
  /** Measures an image; null if the browser can't decode it. */
  measure: (bytes: Uint8Array, mime: ImageMime) => Promise<{ width: number; height: number } | null>;
  /** Redraws an image as PNG, for formats a target can't hold. */
  toPng: (image: LoadedImage, scale?: number) => Promise<LoadedImage | null>;
}

export interface LoadContext {
  vaultPath: string | null;
  /** The exported shard, for image paths relative to it. */
  shardPath: string | null;
}

const MAX_PARALLEL_LOADS = 4;

/** The image type by its first bytes; file extensions lie. */
export function sniffImageMime(bytes: Uint8Array): ImageMime | null {
  const at = (index: number) => bytes[index];
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));

  if (at(0) === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 2) === "BM") return "image/bmp";
  if (ascii(4, 4) === "ftyp" && /^avi[fs]$/.test(ascii(8, 4))) return "image/avif";
  if ((ascii(0, 4) === "II*\0") || (ascii(0, 4) === "MM\0*")) return "image/tiff";
  if (at(0) === 0 && at(1) === 0 && at(2) === 1 && at(3) === 0) return "image/x-icon";

  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || ((head.startsWith("<?xml") || head.startsWith("<!--") || head.startsWith("<!doctype")) && head.includes("<svg"))) {
    return "image/svg+xml";
  }
  return null;
}

function decodeDataUrl(source: string): Uint8Array | null {
  const match = /^data:([^,]*?)(;base64)?,(.*)$/is.exec(source);
  if (!match) return null;
  if (match[2]) {
    const binary = atob(match[3]);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(match[3]));
}

/** Where on disk an image lives, or null for web images. */
export function resolveImagePath(source: string, context: LoadContext): string | null {
  const direct = getFilesystemPathFromMediaSource(source, { vaultPath: context.vaultPath });
  if (direct) return direct;
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return null;

  // A path relative to the shard, as other Markdown apps write them.
  if (!context.shardPath) return null;
  let relative: string;
  try {
    relative = decodeURI(source);
  } catch {
    relative = source;
  }
  const directory = normalizePathSlashes(context.shardPath).split("/").slice(0, -1);
  for (const part of normalizePathSlashes(relative).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") directory.pop();
    else directory.push(part);
  }
  return directory.join("/");
}

async function loadBytes(source: string, context: LoadContext, io: AssetIO): Promise<Uint8Array | null> {
  if (isDataMediaSource(source)) return decodeDataUrl(source);
  if (/^blob:/i.test(source)) {
    const response = await fetch(source);
    return new Uint8Array(await response.arrayBuffer());
  }
  if (isRemoteMediaSource(source)) {
    return /^https?:/i.test(source) ? io.fetchRemote(source) : null;
  }
  const path = resolveImagePath(source, context);
  return path ? io.readLocal(path) : null;
}

/** Natural size of an SVG from its width/height or viewBox. */
export function measureSvg(bytes: Uint8Array): { width: number; height: number } | null {
  const text = new TextDecoder().decode(bytes.subarray(0, 4096));
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return null;
  const attribute = (name: string) => new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag)?.[1];
  const length = (value: string | undefined) => {
    if (!value || value.endsWith("%")) return null;
    const number = parseFloat(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    if (value.endsWith("pt")) return number * (4 / 3);
    if (value.endsWith("em")) return number * 16;
    return number;
  };

  const viewBox = attribute("viewBox")?.split(/[\s,]+/).map(Number);
  const boxWidth = viewBox?.length === 4 && viewBox[2] > 0 ? viewBox[2] : null;
  const boxHeight = viewBox?.length === 4 && viewBox[3] > 0 ? viewBox[3] : null;
  const width = length(attribute("width"));
  const height = length(attribute("height"));

  if (width && height) return { width, height };
  if (boxWidth && boxHeight) {
    if (width) return { width, height: (width * boxHeight) / boxWidth };
    if (height) return { width: (height * boxWidth) / boxHeight, height };
    return { width: boxWidth, height: boxHeight };
  }
  return null;
}

/**
 * Loads every image in `requests`. Images that can't be found or read are
 * left out of the map, and the export shows a note in their place.
 */
export async function loadImages(
  requests: ExportImageRequest[],
  context: LoadContext,
  io: AssetIO,
): Promise<ImageMap> {
  const images: ImageMap = new Map();
  const queue = [...requests];

  const worker = async () => {
    for (let request = queue.shift(); request; request = queue.shift()) {
      try {
        const bytes = await loadBytes(request.source, context, io);
        if (!bytes?.length) continue;
        const mime = sniffImageMime(bytes);
        if (!mime) continue;
        const size = mime === "image/svg+xml" ? measureSvg(bytes) ?? (await io.measure(bytes, mime)) : await io.measure(bytes, mime);
        if (!size) continue;
        images.set(request.id, { bytes, mime, ...size });
      } catch (error) {
        console.warn("[Netherstone] Export left out an image:", request.source, error);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_LOADS, requests.length) }, worker));
  return images;
}

// ── Browser implementation ──────────────────────────────────────────────────

function objectUrl(bytes: Uint8Array, mime: string) {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
}

async function loadElement(bytes: Uint8Array, mime: string): Promise<HTMLImageElement> {
  const url = objectUrl(bytes, mime);
  try {
    const element = new Image();
    element.decoding = "async";
    element.src = url;
    await element.decode();
    return element;
  } finally {
    // The decoded element keeps its pixels.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

export function createBrowserAssetIO(
  readLocal: AssetIO["readLocal"],
  fetchRemote: AssetIO["fetchRemote"],
): AssetIO {
  return {
    readLocal,
    fetchRemote,
    async measure(bytes, mime) {
      try {
        const element = await loadElement(bytes, mime);
        return element.naturalWidth && element.naturalHeight
          ? { width: element.naturalWidth, height: element.naturalHeight }
          : null;
      } catch {
        return null;
      }
    },
    async toPng(image, scale = 1) {
      try {
        const element = await loadElement(image.bytes, image.mime);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        canvas.getContext("2d")?.drawImage(element, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) return null;
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          mime: "image/png",
          width: image.width,
          height: image.height,
        };
      } catch {
        return null;
      }
    },
  };
}

/** Base64 of `bytes`, in chunks so large images don't overflow the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

const base64Cache = new WeakMap<Uint8Array, string>();

/** Base64 of an image, encoded once however often the preview redraws. */
export function cachedBase64(bytes: Uint8Array): string {
  let encoded = base64Cache.get(bytes);
  if (encoded === undefined) {
    encoded = toBase64(bytes);
    base64Cache.set(bytes, encoded);
  }
  return encoded;
}
