import { useState } from "react";
import { RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";

import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SHORTCUT_RECORDER_ATTRIBUTE } from "@/hooks/useAppShortcuts";
import { formatKeys, IS_MAC } from "@/lib/platform";
import {
  assignKeys,
  isChanged,
  type Keys,
  type KeysProblem,
  keysOfPress,
  keysProblem,
  resetKeys,
  resetProblem,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  type Shortcut,
  shownKeys,
} from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";

function KeyChips({ keys }: { keys: Keys }) {
  return (
    <span className="flex gap-1">
      {formatKeys(keys).map((key, i) => (
        <kbd
          key={i}
          className="min-w-6 rounded-md border bg-muted px-1.5 py-0.5 text-center font-sans text-muted-foreground text-ui-sm"
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

/** Every combination of a shortcut, in order. */
function KeysList({ keys }: { keys: readonly Keys[] }) {
  if (keys.length === 0) {
    return <span className="text-muted-foreground text-ui-sm">Not set</span>;
  }
  return (
    <span className="flex items-center gap-1.5">
      {keys.map((each, i) => (
        <span key={each} className="flex items-center gap-1.5">
          {i > 0 ? (
            <span className="text-muted-foreground text-ui-sm">or</span>
          ) : null}
          <KeyChips keys={each} />
        </span>
      ))}
    </span>
  );
}

/** A shortcut's name on the left, its keys on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 px-4 py-2.5">
      <span className="text-ui">{label}</span>
      {children}
    </div>
  );
}

function problemNote(problem: KeysProblem): string {
  switch (problem.kind) {
    case "modifier":
      return IS_MAC ? "Add ⌘ or ⌥" : "Add Ctrl or Alt";
    case "reserved":
      return `Kept for ${problem.label}`;
    case "taken":
      return `Used by ${problem.by.label}`;
  }
}

type RowState =
  | { kind: "recording"; note?: string }
  /** The keys, or null for the defaults, wait on Replace. */
  | { kind: "taken"; keys: Keys | null; by: Shortcut };

function ShortcutRow({ shortcut }: { shortcut: Shortcut }) {
  const overrides = useSettingsStore((s) => s.shortcuts);
  const setPreference = useSettingsStore((s) => s.setPreference);
  const [state, setState] = useState<RowState | null>(null);
  const keys = shownKeys(shortcut, overrides);

  if ("fixed" in shortcut) {
    return (
      <Row label={shortcut.label}>
        <KeysList keys={keys} />
      </Row>
    );
  }

  const save = (next: typeof overrides) => {
    setPreference("shortcuts", next);
    setState(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (state?.kind !== "recording") return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    // Tab still moves on, which ends recording.
    if (plain && e.key === "Tab") return;
    e.preventDefault();
    e.stopPropagation();
    if (plain && e.key === "Escape") {
      setState(null);
      return;
    }
    const pressed = keysOfPress(e);
    if (!pressed) return;
    const problem = keysProblem(shortcut, pressed, overrides);
    if (!problem) {
      save(assignKeys(overrides, shortcut, pressed));
    } else if (problem.kind === "taken" && !("fixed" in problem.by)) {
      setState({ kind: "taken", keys: pressed, by: problem.by });
    } else {
      setState({ kind: "recording", note: problemNote(problem) });
    }
  };

  const reset = () => {
    const problem = resetProblem(shortcut, overrides);
    if (problem) setState({ kind: "taken", keys: null, by: problem.by });
    else save(resetKeys(overrides, shortcut));
  };

  const replace = (pending: Extract<RowState, { kind: "taken" }>) =>
    save(
      pending.keys
        ? assignKeys(overrides, shortcut, pending.keys)
        : resetKeys(overrides, shortcut),
    );

  const recording = state?.kind === "recording";

  return (
    <Row label={shortcut.label}>
      <div className="flex items-center gap-2">
        {state?.kind === "taken" ? (
          <>
            <span className="text-muted-foreground text-ui-sm">
              {problemNote(state)}
            </span>
            <Button variant="outline" size="xs" onClick={() => replace(state)}>
              Replace
            </Button>
            <Button variant="ghost" size="xs" onClick={() => setState(null)}>
              Cancel
            </Button>
          </>
        ) : state?.note ? (
          <span className="text-muted-foreground text-ui-sm">{state.note}</span>
        ) : null}
        {isChanged(shortcut, overrides) && !recording ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Restore default keys for ${shortcut.label}`}
            className="text-muted-foreground"
            onClick={reset}
          >
            <RotateCcwIcon />
          </Button>
        ) : null}
        <button
          type="button"
          {...{ [SHORTCUT_RECORDER_ATTRIBUTE]: "" }}
          aria-label={`Change keys for ${shortcut.label}`}
          aria-pressed={recording}
          onClick={() => setState(recording ? null : { kind: "recording" })}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (recording) setState(null);
          }}
          className={cn(
            "flex min-h-7 items-center rounded-md px-1 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
            recording && "bg-accent ring-2 ring-ring",
          )}
        >
          {recording ? (
            <span className="px-1 text-muted-foreground text-ui-sm">
              Press keys
            </span>
          ) : (
            <KeysList keys={keys} />
          )}
        </button>
      </div>
    </Row>
  );
}

function RestoreDefaultsRow() {
  const [open, setOpen] = useState(false);
  const changed = useSettingsStore(
    (s) => SHORTCUTS.some((shortcut) => isChanged(shortcut, s.shortcuts)),
  );
  const setPreference = useSettingsStore((s) => s.setPreference);

  return (
    <SettingRow label="Restore default shortcuts">
      <Button
        variant="outline"
        size="sm"
        disabled={!changed}
        onClick={() => setOpen(true)}
      >
        Restore defaults
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore default shortcuts?</AlertDialogTitle>
            <AlertDialogDescription>
              Every shortcut goes back to its default keys.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPreference("shortcuts", {});
                toast("Shortcuts restored to their defaults.");
              }}
            >
              Restore defaults
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingRow>
  );
}

export function ShortcutsSettings() {
  return (
    <>
      {SHORTCUT_GROUPS.map((group) => (
        <SettingsGroup key={group.id} title={group.title}>
          {SHORTCUTS.filter((shortcut) => shortcut.group === group.id).map(
            (shortcut) => (
              <ShortcutRow key={shortcut.id} shortcut={shortcut} />
            ),
          )}
        </SettingsGroup>
      ))}
      <p className="px-1 text-muted-foreground text-ui-sm leading-5">
        Markdown works as you type too: start a line with # for a heading, - for
        a list or &gt; for a quote
      </p>
      <SettingsGroup>
        <RestoreDefaultsRow />
      </SettingsGroup>
    </>
  );
}
