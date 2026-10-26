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
import { useShallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
import { cancelIdle, requestIdle } from "@/lib/idle-callback";
import { openEditorFile } from "@/lib/open-editor-file";
import { hasModKey } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store";
import { EditorEmptyState } from "./EditorEmptyState";
import { MountedEditor } from "./MountedEditor";
import { openLinkTarget } from "./lib/link-target";
import { resolveSessionValue } from "./lib/session-value";

/** Longest wait for a quiet moment to remove a closed shard. */
const REMOVE_IDLE_TIMEOUT_MS = 1000;

type EditorSession = {
  tick: number;
  filePath: string;
  content: string;
  value: any[];
  cacheHit: boolean;
};

type EditorSessions = {
  /** The session on screen. */
  displayed: EditorSession | null;
  /**
   * Closed sessions, hidden and removed in the next quiet moment. Removing a
   * long shard takes a while, so the next one (or the empty state) is shown
   * first.
   */
  leaving: EditorSession[];
};

/** Whether Ctrl (⌘ on a Mac) is held, so links can show they'll open. */
function useModKeyHeld() {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const update = (event: KeyboardEvent) => setHeld(hasModKey(event));
    const release = () => setHeld(false);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", release);
    };
  }, []);

  return held;
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
      <div className="mx-auto max-w-xl px-8 py-16 text-ui">
        <p className="font-medium">The editor ran into an error.</p>
        <p className="mt-1 text-muted-foreground">
          The note on disk is unaffected. Reloading it restores the last saved
          version.
        </p>
        <pre className="mt-4 overflow-auto rounded-md bg-muted p-3 text-ui-sm whitespace-pre-wrap">
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
  return (
    <div
      aria-label="Loading document"
      className="editor-loading-bar pointer-events-none sticky top-0 z-50 -mb-0.5 h-0.5 overflow-hidden"
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
  const [{ displayed, leaving }, setSessions] = useState<EditorSessions>({
    displayed: null,
    leaving: [],
  });
  const [, startSessionTransition] = useTransition();
  const isModKeyHeld = useModKeyHeld();

  const showSession = useCallback((next: EditorSession | null) => {
    setSessions(({ displayed: previous, leaving: closed }) => ({
      displayed: next,
      leaving: previous ? [...closed, previous] : closed,
    }));
  }, []);

  useEffect(() => {
    if (leaving.length === 0) return;

    const idleId = requestIdle(
      () => setSessions((sessions) => ({ ...sessions, leaving: [] })),
      { timeout: REMOVE_IDLE_TIMEOUT_MS },
    );
    return () => cancelIdle(idleId);
  }, [leaving]);

  // Follow renames of the displayed session. A stale session (another file is
  // being prepared) keeps its last path, so it doesn't re-register itself in
  // the store.
  useEffect(() => {
    setSessions((sessions) => {
      const session = sessions.displayed;
      return session &&
        currentFilePath &&
        session.tick === editorSessionTick &&
        session.filePath !== currentFilePath
        ? { ...sessions, displayed: { ...session, filePath: currentFilePath } }
        : sessions;
    });
  }, [currentFilePath, editorSessionTick]);

  useEffect(() => {
    const { currentFilePath: filePath, content, initialValue } =
      useEditorStore.getState();

    if (!filePath) {
      showSession(null);
      return;
    }

    let cancelled = false;
    const tick = editorSessionTick;

    void resolveSessionValue(filePath, content, initialValue).then((value) => {
      if (cancelled) return;

      startSessionTransition(() => {
        showSession({
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
  }, [editorSessionTick, showSession]);

  const handleEditorClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!currentFilePath) return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const link = target.closest("a");
      if (!link) return;

      const href = link.getAttribute("href")?.trim();
      if (!href || href.startsWith("#")) return;

      // A link in the text opens on Ctrl+click; a plain click edits it.
      const isTextLink = link.dataset.slateNode === "element";
      if (isTextLink && !hasModKey(event)) {
        event.preventDefault();
        return;
      }

      if (!openLinkTarget(href, currentFilePath)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    [currentFilePath],
  );

  const isStale = displayed !== null && displayed.tick !== editorSessionTick;
  const isLoading = currentFilePath
    ? displayed === null || isStale
    : isOpeningFile;
  const sessions = displayed ? [...leaving, displayed] : leaving;

  return (
    <div
      className={cn(
        "group/editor relative min-h-full",
        !currentFilePath && "flex flex-col",
      )}
      data-mod-held={isModKeyHeld || undefined}
      onClickCapture={handleEditorClick}
    >
      {/* A shard on its way (say, the last one, reopened at launch) gets the
          loading bar rather than a flash of "No shard open". */}
      {isLoading && <EditorLoadingBar />}
      {!currentFilePath && !isOpeningFile && <EditorEmptyState />}

      {sessions.map((session) => {
        const isLeaving = session !== displayed;
        return (
          // While the next note prepares, the previous one stays visible but
          // inert: it's no longer the store's editor, so edits couldn't be
          // saved.
          <div
            key={session.tick}
            className={isStale && !isLeaving ? "opacity-60" : undefined}
            hidden={isLeaving}
            inert={isLeaving || isStale}
          >
            <EditorErrorBoundary filePath={session.filePath}>
              <MountedEditor
                content={session.content}
                currentFilePath={session.filePath}
                initialValue={session.value}
                cacheHit={session.cacheHit}
              />
            </EditorErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
