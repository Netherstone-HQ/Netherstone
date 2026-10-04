import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import {
  DEFAULT_BROWSER_WEBVIEW_LABEL,
  resetBrowserWebviewState,
} from "@/components/browser/browserCommands";
import { BrowserViewController } from "@/components/browser/browserView";

type BrowserWebviewStatus = "idle" | "creating" | "ready" | "unavailable";

interface UseBrowserWebviewOptions {
  isOpen: boolean;
  initialUrl: string;
  label?: string;
}

function isTauriRuntimeAvailable() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function waitForNextPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

async function closeExistingBrowserWebview(label: string) {
  const existingWebview = await Webview.getByLabel(label);
  await existingWebview?.close();
}

export function useBrowserWebview({
  isOpen,
  initialUrl,
  label = DEFAULT_BROWSER_WEBVIEW_LABEL,
}: UseBrowserWebviewOptions) {
  const [viewportElement, setViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [status, setStatus] = useState<BrowserWebviewStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const webviewRef = useRef<Webview | null>(null);
  const hasCreatedWebviewRef = useRef(false);
  const operationIdRef = useRef(0);

  const isReady = status === "ready";

  // Keeps the view over the panel, and pauses it under anything drawn on top.
  useEffect(() => {
    if (!isOpen || !isReady || !viewportElement) return;

    const controller = new BrowserViewController(label, viewportElement);
    controller.start();
    return () => controller.dispose();
  }, [isOpen, isReady, label, viewportElement]);

  useEffect(() => {
    const operationId = ++operationIdRef.current;

    if (!isOpen || !viewportElement) {
      setStatus("idle");
      setError(null);

      const webview = webviewRef.current;
      webviewRef.current = null;
      hasCreatedWebviewRef.current = false;

      if (webview) {
        void webview.close().catch((closeError) => {
          console.error("Failed to close browser webview:", closeError);
        });
      }

      return;
    }

    if (!isTauriRuntimeAvailable()) {
      setStatus("unavailable");
      setError(
        "Run the app with `pnpm tauri dev` to use the native browser panel.",
      );
      return;
    }

    if (hasCreatedWebviewRef.current) {
      return;
    }

    let cancelled = false;

    const createBrowserWebview = async () => {
      setStatus("creating");
      setError(null);

      try {
        await closeExistingBrowserWebview(label);
        await resetBrowserWebviewState(label);
        await waitForNextPaint();

        if (cancelled || operationId !== operationIdRef.current) return;

        const rect = viewportElement.getBoundingClientRect();
        const webview = new Webview(getCurrentWindow(), label, {
          url: initialUrl,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.max(1, Math.round(rect.width)),
          height: Math.max(1, Math.round(rect.height)),
        });

        webviewRef.current = webview;
        hasCreatedWebviewRef.current = true;

        await Promise.all([
          webview.once("tauri://created", () => {
            if (cancelled || operationId !== operationIdRef.current) return;
            setStatus("ready");
          }),
          webview.once("tauri://error", (event) => {
            if (cancelled || operationId !== operationIdRef.current) return;
            console.error("Failed to create browser webview:", event.payload);
            setStatus("unavailable");
            setError("Failed to create the native browser webview.");
          }),
        ]);
      } catch (createError) {
        if (cancelled || operationId !== operationIdRef.current) return;

        console.error("Failed to create browser webview:", createError);
        setStatus("unavailable");
        setError(
          createError instanceof Error
            ? createError.message
            : "Failed to create the native browser webview.",
        );
      }
    };

    void createBrowserWebview();

    return () => {
      cancelled = true;
    };
  }, [initialUrl, isOpen, label, viewportElement]);

  useEffect(() => {
    return () => {
      operationIdRef.current += 1;
      const webview = webviewRef.current;
      webviewRef.current = null;
      hasCreatedWebviewRef.current = false;

      if (webview) {
        void webview.close().catch((closeError) => {
          console.error("Failed to close browser webview:", closeError);
        });
      }
    };
  }, []);

  return {
    setViewportElement,
    status,
    error,
  };
}
