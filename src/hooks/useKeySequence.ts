import { useEffect } from "react";

const normalize = (key: string) => (key.length === 1 ? key.toLowerCase() : key);

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.matches("input, textarea, select"))
  );
}

/**
 * Calls `onMatch` when the latest key presses spell out `sequence`, using
 * `KeyboardEvent.key` names. Letters match either case, and presses inside
 * text fields are ignored. `sequence` should be a stable array.
 */
export function useKeySequence(
  sequence: readonly string[],
  onMatch: () => void,
) {
  useEffect(() => {
    const wanted = sequence.map(normalize);
    let recent: string[] = [];

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || isTyping(e.target)) return;
      recent = [...recent, normalize(e.key)].slice(-wanted.length);
      if (
        recent.length === wanted.length &&
        recent.every((key, i) => key === wanted[i])
      ) {
        recent = [];
        onMatch();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sequence, onMatch]);
}
