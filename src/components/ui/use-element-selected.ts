import { useCallback, useSyncExternalStore } from "react";

import type { SlateEditor, TElement } from "platejs";
import { createSlatePlugin, ElementApi, NodeApi, RangeApi } from "platejs";
import { useEditorRef, useElement } from "platejs/react";

/**
 * Which elements the selection touches, worked out once per change.
 *
 * slate-react's `useSelected` gives every element its own check after each
 * change, so a shard with a thousand @ links ran a thousand checks per key.
 * Here one walk over the selection finds the touched elements, and only
 * the elements whose state flipped are told.
 */
class SelectedElements {
  /** Worked out on first read, so an editor nobody reads does no work. */
  private selected: Set<TElement> | null = null;
  private listeners = new Map<TElement, Set<() => void>>();

  constructor(private editor: SlateEditor) {}

  isSelected(element: TElement) {
    this.selected ??= touchedElements(this.editor);
    return this.selected.has(element);
  }

  subscribe(element: TElement, listener: () => void) {
    let forElement = this.listeners.get(element);
    if (!forElement) {
      forElement = new Set();
      this.listeners.set(element, forElement);
    }
    forElement.add(listener);
    return () => {
      forElement.delete(listener);
      if (forElement.size === 0) this.listeners.delete(element);
    };
  }

  /** Runs after each change. */
  update() {
    const previous = this.selected;
    if (!previous) return;
    const next = touchedElements(this.editor);
    this.selected = next;
    for (const element of previous) if (!next.has(element)) this.notify(element);
    for (const element of next) if (!previous.has(element)) this.notify(element);
  }

  private notify(element: TElement) {
    const forElement = this.listeners.get(element);
    if (forElement) for (const listener of forElement) listener();
  }
}

/**
 * The elements whose range intersects the selection, as `useSelected`
 * decides: every element with a text between the selection's two ends,
 * and their ancestors. None while the editor has no selection.
 */
function touchedElements(editor: SlateEditor) {
  const touched = new Set<TElement>();
  if (!editor.selection) return touched;
  const [start, end] = RangeApi.edges(editor.selection);
  for (const [node] of NodeApi.nodes(editor, { from: start.path, to: end.path })) {
    if (ElementApi.isElement(node)) touched.add(node);
  }
  return touched;
}

const stores = new WeakMap<SlateEditor, SelectedElements>();

/** Keeps the touched elements up to date for `useElementSelected`. */
export const SelectedElementsPlugin = createSlatePlugin({
  key: "selectedElements",
}).overrideEditor(({ editor, api: { onChange } }) => {
  const store = new SelectedElements(editor);
  stores.set(editor, store);
  return {
    api: {
      onChange(options) {
        store.update();
        onChange(options);
      },
    },
  };
});

/**
 * Whether the selection touches the element this is used in, like
 * `useSelected`, at a cost that doesn't grow with the number of elements.
 */
export function useElementSelected() {
  const editor = useEditorRef();
  const element = useElement();
  const store = stores.get(editor);
  if (!store) throw new Error("useElementSelected needs SelectedElementsPlugin in the editor.");
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(element, listener),
    [store, element],
  );
  return useSyncExternalStore(subscribe, () => store.isSelected(element));
}
