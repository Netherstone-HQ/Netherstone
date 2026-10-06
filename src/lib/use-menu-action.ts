import { useCallback, useRef } from "react";

/**
 * Runs a menu item's action once its menu has closed and let go of focus.
 *
 * A Radix menu keeps focus inside itself until it has finished closing, and
 * then hands focus back to whatever had it before. An action that focuses an
 * input (a rename field) or opens a dialog would lose that focus to the menu,
 * which closes the input the moment it opened. Waiting for the menu's
 * `onCloseAutoFocus` gives the action focus with nothing left to take it.
 */
export function useMenuAction() {
  const pendingActionRef = useRef<(() => void) | null>(null);

  const defer = useCallback(
    (action: () => void) => () => {
      pendingActionRef.current = action;
    },
    [],
  );

  const onCloseAutoFocus = useCallback((event: Event) => {
    const action = pendingActionRef.current;
    if (!action) return;

    pendingActionRef.current = null;
    event.preventDefault();
    action();
  }, []);

  return { defer, onCloseAutoFocus };
}
