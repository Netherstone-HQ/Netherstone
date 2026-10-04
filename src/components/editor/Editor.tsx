import {
  Component,
  type ErrorInfo,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useTransition,
} from "react";
import { createSlateEditor, normalizeStaticValue } from "platejs";
import { useShallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
import {
  deserializeEditorMarkdown,
  stripDeviceMediaProps,
} from "@/lib/editor-markdown";
import { deserializeMarkdownInWorker } from "@/lib/editor-markdown-worker";
import { openEditorFile } from "@/lib/open-editor-file";
import { useEditorStore } from "@/store";
import { EditorEmptyState } from "./EditorEmptyState";
import { MountedEditor } from "./MountedEditor";
import { EditorKit } from "./editor-kit";
import {
  formatEditorLifecycleDurationMs,
  getEditorLifecycleNowMs,
  getPlateValueNodeCount,
  logEditorLifecycle,
} from "./lib/editor-lifecycle";

/** Delay before showing the loading bar, so fast opens don't flash it. */
const LOADING_BAR_DELAY_MS = 150;

type EditorSession = {
  tick: number;
  filePath: string;
  content: string;
  value: any[];
  cacheHit: boolean;
};

function isExternalLink(href: string) {
  return (
    /^(https?:|mailto:|tel:|ftp:|file:|data:|blob:|asset:)/i.test(href) ||
    /^https?:\/\/(?:asset|file)\.localhost\//i.test(href)
  );
}

function resolveInternalLinkPath(
  currentFilePath: string,
  href: string,
): string | null {
  const cleanedHref = href.split("#")[0]?.split("?")[0]?.trim();

  if (
    !cleanedHref ||
    cleanedHref.startsWith("#") ||
    cleanedHref.startsWith("/") ||
    isExternalLink(cleanedHref)
  ) {
    return null;
  }

  const normalizedCurrentPath = currentFilePath.replace(/\\/g, "/");
  const lastSlashIndex = normalizedCurrentPath.lastIndexOf("/");
  const baseDir =
    lastSlashIndex >= 0
      ? normalizedCurrentPath.slice(0, lastSlashIndex)
      : normalizedCurrentPath;

  const parts = `${baseDir}/${cleanedHref}`.split("/");
  const resolvedParts: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") continue;

    if (part === "..") {
      if (
        resolvedParts.length > 1 ||
        (resolvedParts.length === 1 && !resolvedParts[0].endsWith(":"))
      ) {
        resolvedParts.pop();
      }
      continue;
    }

    resolvedParts.push(part);
  }

  return resolvedParts.join("/");
}

/**
 * Resolves the initial Plate value for a newly opened file: the cached AST
 * when available, otherwise markdown deserialized in the worker (falling back
 * to the main thread if the worker fails).
 */
async function resolveSessionValue(
  filePath: string,
  content: string,
  cachedValue: any[] | null,
): Promise<any[]> {
  // Values cached before device-specific media props stopped being saved
  // may still carry them.
  if (cachedValue) return stripDeviceMediaProps(cachedValue);

  const startMs = getEditorLifecycleNowMs();
  const deserializeInMainThread = () =>
    normalizeStaticValue(
      deserializeEditorMarkdown(createSlateEditor({ plugins: EditorKit }), content),
    ) as any[];

  try {
    const value = await deserializeMarkdownInWorker(content, {
      filePath,
      fallback: deserializeInMainThread,
    });

    logEditorLifecycle("deserialize:complete", {
      filePath,
      nodeCount: getPlateValueNodeCount(value),
      duration: formatEditorLifecycleDurationMs(startMs),
    });

    return Array.isArray(value) ? (value as any[]) : [];
  } catch (error) {
    console.error("Failed to deserialize markdown in worker:", {
      filePath,
      error,
    });
    return deserializeInMainThread();
  }
}

/**
 * Keeps an editor crash from unmounting the whole app (React drops the entire
 * tree on an uncaught render/effect error), and makes the error visible.
 */
class EditorErrorBoundary extends Component<
  { filePath: string; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Netherstone] Editor crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-xl px-8 py-16 text-sm">
        <p className="font-medium">The editor ran into an error.</p>
        <p className="mt-1 text-muted-foreground">
          The note on disk is unaffected. Reloading it restores the last saved
          version.
        </p>
        <pre className="mt-4 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap">
          {error.message}
        </pre>
        <Button
          className="mt-4"
          onClick={() => {
            // The crashed editor's unsaved edits went with it; there is
            // nothing left to save before reopening.
            useEditorStore.getState().setIsDirty(false);
            void openEditorFile(this.props.filePath).catch((reloadError) => {
              console.error("Failed to reload note:", reloadError);
            });
          }}
          size="sm"
          variant="outline"
        >
          Reload note
        </Button>
      </div>
    );
  }
}

function EditorLoadingBar() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(
      () => setIsVisible(true),
      LOADING_BAR_DELAY_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, []);

  if (!isVisible) return null;

  return (
    <div
      aria-label="Loading document"
      className="pointer-events-none sticky top-0 z-50 -mb-0.5 h-0.5 overflow-hidden"
      role="progressbar"
    >
      <div className="h-full w-1/3 animate-[editor-loading_1s_ease-in-out_infinite] bg-primary/60" />
    </div>
  );
}

export function Editor() {
  const { currentFilePath, editorSessionTick, isOpeningFile } = useEditorStore(
    useShallow((s) => ({
      currentFilePath: s.currentFilePath,
      editorSessionTick: s.editorSessionTick,
      isOpeningFile: s.openingFilePath !== null,
    })),
  );

  // The session on screen. A newly opened file is prepared in the background
  // and swapped in as a transition, so the previous note stays visible (and
  // the app responsive) while the new one renders, instead of a loading
  // screen followed by a long synchronous mount.
  const [displayed, setDisplayed] = useState<EditorSession | null>(null);
  const [, startSessionTransition] = useTransition();

  // Follow renames of the displayed session. A stale session (another file is
  // being prepared) keeps its last path, so it doesn't re-register itself in
  // the store.
  useEffect(() => {
    setDisplayed((session) =>
      session &&
      currentFilePath &&
      session.tick === editorSessionTick &&
      session.filePath !== currentFilePath
        ? { ...session, filePath: currentFilePath }
        : session,
    );
  }, [currentFilePath, editorSessionTick]);

  useEffect(() => {
    const { currentFilePath: filePath, content, initialValue } =
      useEditorStore.getState();

    if (!filePath) {
      setDisplayed(null);
      return;
    }

    let cancelled = false;
    const tick = editorSessionTick;

    logEditorLifecycle("session:resolve:start", {
      filePath,
      markdownChars: content.length,
      cacheHit: initialValue !== null,
    });

    void resolveSessionValue(filePath, content, initialValue).then((value) => {
      if (cancelled) return;

      startSessionTransition(() => {
        setDisplayed({
          tick,
          filePath,
          content,
          value,
          cacheHit: initialValue !== null,
        });
      });
    });

    return () => {
      cancelled = true;
    };
    // Only a new session (open/close) re-resolves; renames keep the tick.
  }, [editorSessionTick]);

  const handleEditorClick = useCallback(
    async (event: MouseEvent<HTMLDivElement>) => {
      if (!currentFilePath) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest("a");
      if (!link) return;

      const href = link.getAttribute("href")?.trim();
      if (!href || href.startsWith("#") || isExternalLink(href)) return;

      const resolvedPath = resolveInternalLinkPath(currentFilePath, href);
      if (!resolvedPath) return;

      event.preventDefault();
      event.stopPropagation();

      try {
        await openEditorFile(resolvedPath);
      } catch (error) {
        console.error("Failed to open linked file:", resolvedPath, error);
      }
    },
    [currentFilePath],
  );

  if (!currentFilePath) {
    // A shard on its way (say, the last one, reopened at launch) gets the
    // loading bar rather than a flash of "No shard open".
    return isOpeningFile ? (
      <div className="relative min-h-full">
        <EditorLoadingBar />
      </div>
    ) : (
      <EditorEmptyState />
    );
  }

  const isStale = displayed !== null && displayed.tick !== editorSessionTick;

  return (
    <div
      className="relative min-h-full"
      onClickCapture={(event) => void handleEditorClick(event)}
    >
      {(displayed === null || isStale) && <EditorLoadingBar />}

      {displayed && (
        // While the next note prepares, the previous one stays visible but
        // inert: it's no longer the store's editor, so edits couldn't be saved.
        <div className={isStale ? "opacity-60" : undefined} inert={isStale}>
          <EditorErrorBoundary
            key={displayed.tick}
            filePath={displayed.filePath}
          >
            <MountedEditor
              content={displayed.content}
              currentFilePath={displayed.filePath}
              initialValue={displayed.value}
              cacheHit={displayed.cacheHit}
            />
          </EditorErrorBoundary>
        </div>
      )}
    </div>
  );
}
