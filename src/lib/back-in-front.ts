import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Resolves once the app's window is in front again, as after a system
 * settings screen. On Android the WebView doesn't say so itself (its page
 * stays "visible"), the window does.
 */
export async function backInFront(): Promise<void> {
  let stop: (() => void) | undefined;
  await new Promise<void>((resolve) => {
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) resolve();
      })
      .then((unlisten) => {
        stop = unlisten;
      });
  });
  stop?.();
}
