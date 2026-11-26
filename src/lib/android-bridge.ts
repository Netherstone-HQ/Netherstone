import { IS_ANDROID } from "@/lib/platform";

/** What MainActivity.kt offers the page on Android. */
export interface AndroidBridge {
  insets(): string;
  openAppSettings(): void;
  /** Shows or hides the keyboard; focus and the caret stay. */
  setKeyboard(shown: boolean): void;
  /** Offers an export to share (see `shareExportPath`) to other apps. */
  shareFile(path: string, mimeType: string): void;
  /** Opens the print screen with an export's print page; geometry is JSON. */
  printPage(html: string, jobName: string, geometry: string): void;
  /** Shows a web page over the app, in the browser's custom tab. */
  openInApp(url: string): void;
  /** Hands the downloaded update to the installer; false when it can't yet. */
  installUpdate(): boolean;
  /** Whether vaults may live in the phone's shared storage. */
  hasAllFilesAccess(): boolean;
  /** Asks for that access, in its settings screen or a prompt. */
  askAllFilesAccess(): void;
  /** Shows the folder picker; the page hears `folderpicked`. */
  pickFolder(): void;
}

declare global {
  interface Window {
    NetherstoneAndroid?: AndroidBridge;
  }
}

/** The Android app's bridge, or undefined anywhere else. */
export function androidBridge(): AndroidBridge | undefined {
  return IS_ANDROID ? window.NetherstoneAndroid : undefined;
}
