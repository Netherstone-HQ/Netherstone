import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowClockwiseIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  PauseIcon,
  XIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/store";
import { useBrowserWebview } from "@/components/browser/useBrowserWebview";
import {
  BROWSER_STATE_EVENT,
  type BrowserStateSnapshot,
  CANVAS_BROWSER_WEBVIEW_LABEL,
  DEFAULT_BROWSER_WEBVIEW_LABEL,
  getBrowserWebviewState,
  goBackBrowserWebview,
  goForwardBrowserWebview,
  navigateBrowserWebview,
  reloadBrowserWebview,
  stopBrowserWebviewLoading,
} from "@/components/browser/browserCommands";

import { Progress } from "@/components/ui/progress";

const DEFAULT_BROWSER_URL = "https://netherstone.app";

interface BrowserPanelProps {
  webviewLabel?: string;
}

function getHostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function normalizeBrowserUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return DEFAULT_BROWSER_URL;
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.includes(".") && !trimmed.includes(" ")) {
    return `https://${trimmed}`;
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

export function BrowserPanel({
  webviewLabel = DEFAULT_BROWSER_WEBVIEW_LABEL,
}: BrowserPanelProps) {
  const isCanvasBrowser = webviewLabel === CANVAS_BROWSER_WEBVIEW_LABEL;

  const isBrowserPanelOpen = useUIStore((s) =>
    isCanvasBrowser ? s.isCanvasBrowserPanelOpen : s.isBrowserPanelOpen,
  );
  const setBrowserPanelOpen = useUIStore((s) =>
    isCanvasBrowser ? s.setCanvasBrowserPanelOpen : s.setBrowserPanelOpen,
  );
  const browserLastUrl = useUIStore((s) =>
    isCanvasBrowser ? s.canvasBrowserLastUrl : s.browserLastUrl,
  );
  const setBrowserLastUrl = useUIStore((s) =>
    isCanvasBrowser ? s.setCanvasBrowserLastUrl : s.setBrowserLastUrl,
  );

  const initialBrowserUrl = browserLastUrl ?? DEFAULT_BROWSER_URL;
  const [currentUrl, setCurrentUrl] = useState(initialBrowserUrl);
  const [address, setAddress] = useState(initialBrowserUrl);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [isCommandPending, setIsCommandPending] = useState(false);
  const [isPageLoading, setIsPageLoading] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const latestKnownUrlRef = useRef(currentUrl);

  const { setViewportElement, status, error } = useBrowserWebview({
    isOpen: isBrowserPanelOpen,
    initialUrl: initialBrowserUrl,
    label: webviewLabel,
  });

  const isBrowserReady = status === "ready";
  const isBusy = status === "creating" || isCommandPending;

  useEffect(() => {
    setCurrentUrl(initialBrowserUrl);
    setAddress(initialBrowserUrl);
  }, [initialBrowserUrl, webviewLabel]);

  const applyBrowserState = useCallback(
    (state: BrowserStateSnapshot) => {
      const trimmedUrl = state.url.trim();

      if (trimmedUrl && trimmedUrl !== "about:blank") {
        const normalizedUrl = normalizeBrowserUrl(trimmedUrl);
        setCurrentUrl(normalizedUrl);
        setAddress(normalizedUrl);
        setBrowserLastUrl(normalizedUrl);
      }

      setIsPageLoading(state.isLoading);
      setCanGoBack(state.canGoBack);
      setCanGoForward(state.canGoForward);
    },
    [setBrowserLastUrl],
  );

  const syncBrowserState = useCallback(async () => {
    try {
      const state = await getBrowserWebviewState(webviewLabel);
      applyBrowserState(state);
      return state;
    } catch (syncError) {
      console.error("Failed to read browser state:", syncError);
      return null;
    }
  }, [applyBrowserState, webviewLabel]);

  const runBrowserCommand = useCallback(
    async (command: () => Promise<void>) => {
      if (!isBrowserReady) {
        setCommandError("Browser webview is not ready yet.");
        return false;
      }

      setCommandError(null);
      setIsCommandPending(true);
      setIsPageLoading(true);

      try {
        await command();
        return true;
      } catch (commandError) {
        console.error("Browser command failed:", commandError);
        setCommandError(
          commandError instanceof Error
            ? commandError.message
            : String(commandError),
        );
        return false;
      } finally {
        setIsCommandPending(false);
      }
    },
    [isBrowserReady],
  );

  const navigateTo = useCallback(
    async (nextAddress: string) => {
      const nextUrl = normalizeBrowserUrl(nextAddress);

      if (nextUrl === currentUrl) {
        void runBrowserCommand(() => reloadBrowserWebview(webviewLabel));
        return;
      }

      setAddress(nextUrl);
      const navigated = await runBrowserCommand(() =>
        navigateBrowserWebview(nextUrl, webviewLabel),
      );

      if (!navigated) {
        setAddress(currentUrl);
        return;
      }
    },
    [currentUrl, runBrowserCommand, webviewLabel],
  );

  const closeBrowserPanel = useCallback(() => {
    setBrowserLastUrl(currentUrl);
    setBrowserPanelOpen(false);
  }, [currentUrl, setBrowserLastUrl, setBrowserPanelOpen]);

  const stopLoading = useCallback(() => {
    void runBrowserCommand(() => stopBrowserWebviewLoading(webviewLabel)).then(
      (stopped) => {
        if (!stopped) return;
        setIsPageLoading(false);
      },
    );
  }, [runBrowserCommand, webviewLabel]);

  useEffect(() => {
    if (!isBrowserPanelOpen) {
      setIsPageLoading(false);
      setIsCommandPending(false);
      setCanGoBack(false);
      setCanGoForward(false);
    }
  }, [isBrowserPanelOpen]);

  useEffect(() => {
    latestKnownUrlRef.current = currentUrl;
  }, [currentUrl]);

  useEffect(() => {
    if (!isBrowserPanelOpen || !isBrowserReady) {
      return;
    }

    void syncBrowserState();
  }, [isBrowserPanelOpen, isBrowserReady, syncBrowserState]);

  useEffect(() => {
    if (!isBrowserPanelOpen) {
      return;
    }

    let cancelled = false;
    let unlistenState: (() => void) | undefined;

    listen<BrowserStateSnapshot>(BROWSER_STATE_EVENT, (event) => {
      if (cancelled) return;
      if (event.payload.label !== webviewLabel) return;
      applyBrowserState(event.payload);
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
  }, [applyBrowserState, isBrowserPanelOpen, webviewLabel]);

  useEffect(() => {
    return () => {
      setBrowserLastUrl(latestKnownUrlRef.current);
    };
  }, [setBrowserLastUrl]);

  const statusMessage = useMemo(() => {
    if (commandError) return commandError;
    if (error) return error;
    if (status === "creating") return "Loading browser webview…";
    if (status === "unavailable") return "Browser webview is unavailable.";
    return null;
  }, [commandError, error, status]);

  if (!isBrowserPanelOpen) return null;

  return (
    <aside className="flex h-full min-w-0 flex-col border-l bg-background">
      <div className="flex min-h-0 flex-1 flex-col">
        <form
          className="relative flex items-center gap-2 border-b bg-muted/20 px-3 py-1.25"
          onSubmit={(event) => {
            event.preventDefault();
            void navigateTo(address);
          }}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void runBrowserCommand(() => goBackBrowserWebview(webviewLabel));
            }}
            disabled={isBusy || !isBrowserReady || !canGoBack}
            aria-label="Go back"
            title={canGoBack ? "Go back" : "No page to go back to"}
          >
            <ArrowLeftIcon className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void runBrowserCommand(() =>
                goForwardBrowserWebview(webviewLabel),
              );
            }}
            disabled={isBusy || !isBrowserReady || !canGoForward}
            aria-label="Go forward"
            title={canGoForward ? "Go forward" : "No page to go forward to"}
          >
            <ArrowRightIcon className="size-4" />
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              if (isPageLoading) {
                stopLoading();
                return;
              }

              void runBrowserCommand(() => reloadBrowserWebview(webviewLabel));
            }}
            disabled={isBusy || !isBrowserReady}
            aria-label={isPageLoading ? "Stop loading page" : "Refresh page"}
            title={isPageLoading ? "Stop loading" : "Refresh"}
          >
            {isPageLoading ? (
              <XIcon className="size-4" weight="bold" />
            ) : (
              <ArrowClockwiseIcon className="size-4" />
            )}
          </Button>

          <input
            type="text"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-3 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            placeholder="Enter a URL or search"
            aria-label="Browser address"
            disabled={isBusy || !isBrowserReady}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void closeBrowserPanel();
            }}
            aria-label="Close browser panel"
            title="Close browser panel"
          >
            <XIcon className="size-4" />
          </Button>

          {isPageLoading && (
            <>
              <style>{`@keyframes browser-panel-loading { 0% { transform: translateX(-140%); } 50% { transform: translateX(-10%); } 100% { transform: translateX(220%); } }`}</style>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden bg-transparent">
                <div className="absolute inset-x-0 bottom-0 h-px bg-border/50" />
                <Progress
                  aria-label="Page loading"
                  className="h-px bg-transparent **:data-[slot=progress-indicator]:bg-transparent"
                  value={0}
                />
                <div className="absolute bottom-0 left-0 h-px w-1/3 bg-primary/70 animate-[browser-panel-loading_1.1s_ease-in-out_infinite]" />
              </div>
            </>
          )}
        </form>

        {statusMessage && (
          <div className="border-b bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            {statusMessage}
          </div>
        )}

        <div
          ref={setViewportElement}
          className="relative h-full min-h-0 overflow-hidden"
        >
          {/* Always drawn beneath the native view, so when the browser pauses
              for something drawn over it, this is already on screen. */}
          {isBrowserReady && (
            <div
              aria-hidden
              data-slot="browser-paused"
              className="pointer-events-none absolute inset-0 flex select-none flex-col items-center justify-center gap-1.5 bg-muted/40 text-muted-foreground"
            >
              <PauseIcon className="size-5" weight="fill" />
              <span className="text-xs">Paused</span>
              <span className="max-w-[80%] truncate text-xs opacity-70">
                {getHostname(currentUrl)}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
