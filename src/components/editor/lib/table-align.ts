import {
  BaseTablePlugin,
  getCellIndices,
  getCellTypes,
  getColSpan,
} from "@platejs/table";
import {
  type SlateEditor,
  type TElement,
  type TTableCellElement,
  ElementApi,
  KEYS,
} from "platejs";

export type ColumnAlign = "left" | "center" | "right";

/** The grid columns a cell covers. */
function columnsOf(editor: SlateEditor, cell: TTableCellElement): number[] {
  const { col } = getCellIndices(editor, cell);
  return Array.from({ length: getColSpan(cell) }, (_, offset) => col + offset);
}

/**
 * The cells the toolbar acts on: the selected ones, or the cell holding the
 * caret.
 */
function targetCells(editor: SlateEditor): TTableCellElement[] {
  const selected = editor.getApi(BaseTablePlugin).table.getSelectedCells();
  if (selected?.length) return selected as TTableCellElement[];
  const entry = editor.api.above<TTableCellElement>({
    match: { type: getCellTypes(editor) },
  });
  return entry ? [entry[0]] : [];
}

/** The alignment of the column holding the caret, read from its cell. */
export function columnAlignAt(editor: SlateEditor): ColumnAlign {
  const [cell] = targetCells(editor);
  const paragraph = cell?.children.find(
    (child) => ElementApi.isElement(child) && child.type === KEYS.p,
  ) as (TElement & { align?: string }) | undefined;
  switch (paragraph?.align) {
    case "center":
      return "center";
    case "right":
    case "end":
      return "right";
    default:
      return "left";
  }
}

/**
 * Aligns whole columns. A saved table keeps one alignment per column (the
 * pipe table's `:---:`), so every cell in the columns the selection touches
 * is aligned, not only the selected ones.
 */
export function setColumnAlign(editor: SlateEditor, align: ColumnAlign) {
  const cells = targetCells(editor);
  const tableEntry = editor.api.above<TElement>({
    match: { type: KEYS.table },
  });
  if (!cells.length || !tableEntry) return;

  const columns = new Set(cells.flatMap((cell) => columnsOf(editor, cell)));

  const [table, tablePath] = tableEntry;
  editor.tf.withoutNormalizing(() => {
    table.children.forEach((row, rowIndex) => {
      (row as TElement).children.forEach((node, cellIndex) => {
        const cell = node as TTableCellElement;
        if (!columnsOf(editor, cell).some((col) => columns.has(col))) return;
        cell.children.forEach((child, childIndex) => {
          if (ElementApi.isElement(child) && child.type === KEYS.p) {
            editor.tf.setNodes(
              { align },
              { at: [...tablePath, rowIndex, cellIndex, childIndex] },
            );
          }
        });
      });
    });
  });
}
