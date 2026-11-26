import { getCurrentWindow } from "@tauri-apps/api/window";

/** Resolves once the app's window is in front again, such as after a settings screen. */
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
