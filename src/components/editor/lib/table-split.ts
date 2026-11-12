import { getCellTypes, getColSpan, getRowSpan } from "@platejs/table";
import type { SlateEditor, TTableCellElement } from "platejs";

/**
 * Whether the caret sits in a merged cell that Split can break up. Plate's
 * `useTableMergeState` never says so: its cell lookup drops a lone cell, so
 * the caret's own cell is never found.
 */
export function canSplitCellAt(editor: SlateEditor): boolean {
  if (!editor.api.isCollapsed()) return false;
  const entry = editor.api.above<TTableCellElement>({
    match: { type: getCellTypes(editor) },
  });
  if (!entry) return false;
  return getColSpan(entry[0]) > 1 || getRowSpan(entry[0]) > 1;
}
