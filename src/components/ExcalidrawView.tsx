import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { BrowserPanel } from "@/components/browser/BrowserPanel";
import {
  CANVAS_BROWSER_WEBVIEW_LABEL,
  LIBRARY_RETURN_EVENT,
  type LibraryReturnPayload,
} from "@/components/browser/browserCommands";
import { useTheme } from "@/components/theme/theme-provider";
import { resolveThemeMode } from "@/components/theme/themes";
import { isPathWithin } from "@/lib/drawing-files";
import { useUIStore, useVaultStore } from "@/store";

const ExcalidrawCanvas = lazy(() =>
  import("./ExcalidrawCanvas").then((mod) => ({
    default: mod.ExcalidrawCanvas,
  })),
);

function isLibraryReturnUrl(url: string) {
  try {
    const parsed = new URL(url);
    // Compared by parts: `origin` is "null" for custom schemes such as the
    // production `tauri://localhost`.
    return (
      parsed.protocol === window.location.protocol &&
      parsed.host === window.location.host &&
      parsed.pathname === window.location.pathname &&
      parsed.hash.includes("addLibrary")
    );
  } catch {
    return false;
  }
}

export function ExcalidrawView() {
  const { theme } = useTheme();
  const setBrowserPanelOpen = useUIStore((s) => s.setCanvasBrowserPanelOpen);
  const isBrowserPanelOpen = useUIStore((s) => s.isCanvasBrowserPanelOpen);
  const setBrowserLastUrl = useUIStore((s) => s.setCanvasBrowserLastUrl);
  const activeDrawingPath = useUIStore((s) => s.activeDrawingPath);
  const drawingSessionKey = useUIStore((s) => s.drawingSessionKey);
  const openDrawing = useUIStore((s) => s.openDrawing);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const [excalidrawTheme, setExcalidrawTheme] = useState<"light" | "dark">(() =>
    resolveThemeMode(
      theme,
      window.matchMedia("(prefers-color-scheme: dark)").matches,
    ),
  );
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (theme !== "system") {
      setExcalidrawTheme(resolveThemeMode(theme, false));
      return;
    }

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setExcalidrawTheme(e.matches ? "dark" : "light");
    };
    setExcalidrawTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // A drawing from another vault stays closed after switching vaults.
  const drawingPath =
    activeDrawingPath &&
    currentVaultPath &&
    isPathWithin(activeDrawingPath, currentVaultPath)
      ? activeDrawingPath
      : null;

  useEffect(() => {
    if (activeDrawingPath && !drawingPath) {
      openDrawing(null);
    }
  }, [activeDrawingPath, drawingPath, openDrawing]);

  useEffect(() => {
    if (!window.name) {
      window.name = "netherstone";
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest<HTMLAnchorElement>(
        "a.library-menu-browse-button[href]",
      );

      if (!link) return;

      event.preventDefault();
      event.stopPropagation();

      setBrowserLastUrl(link.href);
      setBrowserPanelOpen(true);
    };

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [setBrowserLastUrl, setBrowserPanelOpen]);

  useEffect(() => {
    let cancelled = false;
    let unlistenState: (() => void) | undefined;

    // The browser stops the navigation back to the app and hands its URL
    // over, so the app never loads inside the browser.
    listen<LibraryReturnPayload>(LIBRARY_RETURN_EVENT, (event) => {
      if (cancelled) return;
      if (event.payload.label !== CANVAS_BROWSER_WEBVIEW_LABEL) return;

      const returnedUrl = event.payload.url.trim();
      if (!returnedUrl || !isLibraryReturnUrl(returnedUrl)) {
        return;
      }

      const parsed = new URL(returnedUrl);
      window.history.replaceState(null, "", parsed.hash || "#");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      setBrowserPanelOpen(false);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenState = unlisten;
      }
    });

    return () => {
      cancelled = true;
      unlistenState?.();
    };
  }, [setBrowserPanelOpen]);

  return (
    <div ref={containerRef} className="flex h-full min-w-0 bg-background">
      <div className="min-w-0 flex-1">
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
              Loading canvas…
            </div>
          }
        >
          <ExcalidrawCanvas
            key={drawingSessionKey}
            drawingPath={drawingPath}
            theme={excalidrawTheme}
            libraryReturnUrl={window.location.origin + window.location.pathname}
          />
        </Suspense>
      </div>

      {isBrowserPanelOpen && (
        <div className="min-w-88 max-w-[60%] basis-[32%] border-l">
          <BrowserPanel webviewLabel={CANVAS_BROWSER_WEBVIEW_LABEL} />
        </div>
      )}
    </div>
  );
}
