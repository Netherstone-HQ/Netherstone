import {
  Component,
  type ErrorInfo,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useShallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
import { cancelIdle, requestIdle } from "@/lib/idle-callback";
import { writeLeftShardCaches } from "@/hooks/useAutosave";
import { openEditorFile } from "@/lib/open-editor-file";
import {
  discardCrashedEdits,
  hasCrashedEdits,
  keepCrashedEdits,
  offerCrashedEdits,
  restoreCrashedEditsOrSay,
} from "@/lib/unsaved-edits";
import { hasModKey } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { isAssistantOn } from "@/lib/assistant";
import { useEditorStore } from "@/store";
import { EditorEmptyState } from "./EditorEmptyState";
import { MountedEditor } from "./MountedEditor";
import { openLinkTarget } from "./lib/link-target";
import { resolveSessionValue } from "./lib/session-value";

/**
 * Longest wait for a quiet moment to remove a closed shard, and then to
 * send its cache entry.
 */
const LEAVE_IDLE_TIMEOUT_MS = 1000;

// Input to a shard that is closing or about to be replaced: its edits
// couldn't be saved, so nothing reaches it.
const stopEvent = (event: SyntheticEvent) => {
  event.preventDefault();
  event.stopPropagation();
};
const blurTarget = (event: FocusEvent<HTMLElement>) => event.target.blur();
const INACTIVE_EVENTS = {
  onPointerDownCapture: stopEvent,
  onMouseDownCapture: stopEvent,
  onClickCapture: stopEvent,
  onDoubleClickCapture: stopEvent,
  onContextMenuCapture: stopEvent,
  onDragStartCapture: stopEvent,
  onDropCapture: stopEvent,
  onFocusCapture: blurTarget,
};

type EditorSession = {
  tick: number;
  filePath: string;
  content: string;
  value: any[];
  cacheHit: boolean;
  /** Whether the shard has inline Ask: only while the assistant is on. */
  inlineAsk: boolean;
  /** Whether `value` holds edits that aren't saved yet. */
  unsaved: boolean;
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

/**
 * Marks the link under the pointer while Ctrl (⌘ on a Mac) is held, so it
 * shows it will open. Only that link changes: marking the whole editor
 * restyled all of a long shard on every Ctrl press, as for a paste anywhere.
 */
function useModKeyLinks(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let held = false;
    let link: Element | null = null;
    const show = () => {
      // A link the editor has since replaced is let go.
      if (link && !link.isConnected) link = null;
      link?.toggleAttribute("data-mod-held", held);
    };
    const update = (event: KeyboardEvent) => {
      held = hasModKey(event);
      show();
    };
    const release = () => {
      held = false;
      show();
    };
    const point = (next: Element | null) => {
      if (next !== link) link?.removeAttribute("data-mod-held");
      link = next;
      show();
    };
    const hover = (event: globalThis.MouseEvent) => {
      held = hasModKey(event);
      point(event.target instanceof Element ? event.target.closest(".editor-link") : null);
    };
    const leave = () => point(null);
    root.addEventListener("mouseover", hover);
    root.addEventListener("mouseleave", leave);
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => {
      root.removeEventListener("mouseover", hover);
      root.removeEventListener("mouseleave", leave);
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", release);
    };
  }, [ref]);
}

/**
 * Keeps an editor crash from unmounting the whole app (React drops the entire
 * tree on an uncaught render/effect error), and makes the error visible. The
 * crashed editor's unsaved edits are kept, so they can be restored.
 */
class EditorErrorBoundary extends Component<
  { filePath: string; tick: number; children: ReactNode },
  { error: Error | null; editsKept: boolean }
> {
  state: { error: Error | null; editsKept: boolean } = {
    error: null,
    editsKept: false,
  };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Netherstone] Editor crashed:", error, info.componentStack);

    // The editor is still in the store until its teardown runs after this.
    const { plateEditor, editorSessionTick, isDirty } =
      useEditorStore.getState();
    const keep =
      plateEditor && isDirty && editorSessionTick === this.props.tick
        ? keepCrashedEdits(this.props.filePath, plateEditor).then(() => true)
        : // Nothing new to keep; a copy from an earlier crash still counts.
          hasCrashedEdits(this.props.filePath);
    keep.then(
      (editsKept) => this.setState({ editsKept }),
      (keepError) =>
        console.error("[Netherstone] Couldn't keep unsaved edits:", keepError),
    );
  }

  private reload = async () => {
    // The crashed editor's edits are kept elsewhere, or gone; reloading
    // shows the saved version, so a kept copy goes.
    useEditorStore.getState().setIsDirty(false);
    try {
      if (this.state.editsKept) await discardCrashedEdits(this.props.filePath);
      await openEditorFile(this.props.filePath);
    } catch (reloadError) {
      console.error("Failed to reload shard:", reloadError);
    }
  };

  render() {
    const { error, editsKept } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="mx-auto max-w-xl px-8 py-16 text-ui">
        <p className="font-medium">The editor ran into an error.</p>
        <p className="mt-1 text-muted-foreground">
          The shard on disk is unaffected. Reloading opens the last saved
          version without your unsaved edits.
        </p>
        <pre className="mt-4 overflow-auto rounded-md bg-muted p-3 text-ui-sm whitespace-pre-wrap">
          {error.message}
        </pre>
        <div className="mt-4 flex gap-2">
          {editsKept && (
            <Button
              onClick={() => restoreCrashedEditsOrSay(this.props.filePath)}
              size="sm"
            >
              Restore unsaved edits
            </Button>
          )}
          <Button onClick={() => void this.reload()} size="sm" variant="outline">
            Reload shard
          </Button>
        </div>
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
  const rootRef = useRef<HTMLDivElement>(null);
  useModKeyLinks(rootRef);

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
      { timeout: LEAVE_IDLE_TIMEOUT_MS },
    );
    return () => cancelIdle(idleId);
  }, [leaving]);

  // Once the left shards are gone, their cache entries go to Rust.
  useEffect(() => {
    if (leaving.length > 0) return;

    const idleId = requestIdle(() => void writeLeftShardCaches(), {
      timeout: LEAVE_IDLE_TIMEOUT_MS,
    });
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
    const {
      currentFilePath: filePath,
      content,
      initialValue,
      opensUnsaved,
    } = useEditorStore.getState();

    if (!filePath) {
      showSession(null);
      return;
    }

    let cancelled = false;
    const tick = editorSessionTick;

    void Promise.all([
      resolveSessionValue(filePath, content, initialValue),
      isAssistantOn(),
    ]).then(([value, inlineAsk]) => {
      if (cancelled) return;

      startSessionTransition(() => {
        showSession({
          tick,
          filePath,
          content,
          value,
          cacheHit: initialValue !== null,
          inlineAsk,
          unsaved: opensUnsaved,
        });
      });
    });

    return () => {
      cancelled = true;
    };
    // Only a new session (open/close) re-resolves; renames keep the tick.
  }, [editorSessionTick, showSession]);

  // Edits kept from a crash are offered each time their shard opens, unless
  // it opens with them.
  useEffect(() => {
    if (useEditorStore.getState().opensUnsaved) return;
    return offerCrashedEdits();
  }, [editorSessionTick]);

  const handleEditorClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (!currentFilePath) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest("[data-inactive-session]")) return;

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
  // The shard on screen comes first: with any rule that tests `:last-child`
  // on every element, WebKit restyles a whole long shard when an element is
  // added after it, but not before it (see structural-selectors.test.ts).
  const sessions = displayed ? [displayed, ...leaving] : leaving;

  // A shard switched to or closed from the keyboard leaves focus in it.
  useEffect(() => {
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.closest("[data-inactive-session]") &&
      rootRef.current?.contains(active)
    ) {
      active.blur();
    }
  }, [isStale, leaving]);

  return (
    <div
      className={cn(
        "group/editor relative min-h-full",
        !currentFilePath && "flex flex-col",
      )}
      ref={rootRef}
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
          // takes no input: it's no longer the store's editor, so edits
          // couldn't be saved. `inert`, `hidden` and `pointer-events` restyle
          // every node of a long shard (about a second each in WebKit);
          // content-visibility and event guards don't.
          <div
            key={session.tick}
            className={cn(
              isLeaving &&
                "absolute inset-x-0 top-0 h-0 [content-visibility:hidden]",
              isStale && !isLeaving && "opacity-60",
            )}
            data-inactive-session={isLeaving || isStale || undefined}
            aria-hidden={isLeaving || isStale || undefined}
            {...(isLeaving || isStale ? INACTIVE_EVENTS : {})}
          >
            <EditorErrorBoundary
              filePath={session.filePath}
              tick={session.tick}
            >
              <MountedEditor
                content={session.content}
                currentFilePath={session.filePath}
                initialValue={session.value}
                cacheHit={session.cacheHit}
                inlineAsk={session.inlineAsk}
                unsaved={session.unsaved}
              />
            </EditorErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
