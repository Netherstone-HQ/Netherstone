import { IS_ANDROID } from "@/lib/platform";

/** Base64 of `bytes`, in chunks so large files don't overflow the stack. */
export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * The body of a command that takes bytes. Android's webview can't send raw
 * bytes to the app, so there they go as base64.
 */
export function bytesBody(bytes: Uint8Array): Uint8Array | { base64: string } {
  return IS_ANDROID ? { base64: toBase64(bytes) } : bytes;
}
