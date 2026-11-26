import { IS_ANDROID } from "@/lib/platform";

/**
 * How handing the update to the installer went: started, or the file is
 * missing, isn't this app (and was deleted), or the app may not install
 * apps yet (its setting is open).
 */
export type UpdateInstall =
  | "started"
  | "missing"
  | "not-this-app"
  | "not-allowed";

/** What the system bars and the keyboard cover, in CSS px. */
export type SystemInsets = { keyboard?: number; top?: number; bottom?: number };

/** What MainActivity.kt offers the page on Android. */
export interface AndroidBridge {
  insets(): Promise<SystemInsets>;
  openAppSettings(): void;
  /** Shows or hides the keyboard; focus and the caret stay. */
  setKeyboard(shown: boolean): void;
  /** Offers an export to share (see `shareExportPath`) to other apps. */
  shareFile(path: string, mimeType: string): void;
  /** Opens the print screen with an export's print page; geometry is JSON. */
  printPage(html: string, jobName: string, geometry: string): void;
  /** Shows a web page over the app, in the browser's custom tab. */
  openInApp(url: string): void;
  /** Hands the downloaded update to the installer, or says why not. */
  installUpdate(): Promise<UpdateInstall>;
  /** Whether vaults may live in the phone's shared storage. */
  hasAllFilesAccess(): Promise<boolean>;
  /** Asks for that access, in its settings screen or a prompt. */
  askAllFilesAccess(): void;
  /** Shows the folder picker; the page hears `folderpicked`. */
  pickFolder(): void;
}

/** What MainActivity.kt puts on the app's page to send it calls. */
interface AndroidPort {
  postMessage(message: string): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<string>) => void,
  ): void;
}

declare global {
  interface Window {
    NetherstoneAndroid?: AndroidPort;
  }
}

const bridges = new WeakMap<AndroidPort, AndroidBridge>();

/** The Android app's bridge, or undefined anywhere else. */
export function androidBridge(): AndroidBridge | undefined {
  const port = IS_ANDROID ? window.NetherstoneAndroid : undefined;
  if (!port) return undefined;
  let bridge = bridges.get(port);
  if (!bridge) {
    bridge = connect(port);
    bridges.set(port, bridge);
  }
  return bridge;
}

/**
 * Each call goes to MainActivity.kt as `{method, args}`. A call that wants
 * an answer also has an `id`, and the answer comes back with it.
 */
function connect(port: AndroidPort): AndroidBridge {
  const waiting = new Map<number, (result: unknown) => void>();
  let lastId = 0;
  port.addEventListener("message", (event) => {
    const { id, result } = JSON.parse(event.data) as {
      id: number;
      result: unknown;
    };
    waiting.get(id)?.(result);
    waiting.delete(id);
  });
  const tell = (method: string, ...args: unknown[]) =>
    port.postMessage(JSON.stringify({ method, args }));
  const ask = <T>(method: string) =>
    new Promise<T>((resolve) => {
      lastId += 1;
      waiting.set(lastId, (result) => resolve(result as T));
      port.postMessage(JSON.stringify({ method, args: [], id: lastId }));
    });
  return {
    insets: () => ask("insets"),
    openAppSettings: () => tell("openAppSettings"),
    setKeyboard: (shown) => tell("setKeyboard", shown),
    shareFile: (path, mimeType) => tell("shareFile", path, mimeType),
    printPage: (html, jobName, geometry) =>
      tell("printPage", html, jobName, geometry),
    openInApp: (url) => tell("openInApp", url),
    installUpdate: () => ask("installUpdate"),
    hasAllFilesAccess: () => ask("hasAllFilesAccess"),
    askAllFilesAccess: () => tell("askAllFilesAccess"),
    pickFolder: () => tell("pickFolder"),
  };
}
