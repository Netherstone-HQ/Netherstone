// Column and row resizing for the table node: the drag controller, the
// context the cells read their handles from, and the width helpers.

import * as React from "react";

import { resizeLengthClampStatic } from "@platejs/resizable";
import { setTableColSize, setTableRowSize } from "@platejs/table";
import {
  TablePlugin,
  roundCellSizeToStep,
  useOverrideColSize,
  useOverrideRowSize,
  useTableColSizes,
} from "@platejs/table/react";
import { type TTableElement } from "platejs";
import { useEditorPlugin } from "platejs/react";

export const TABLE_DEFAULT_COLUMN_WIDTH = 120;
/** Narrowest a column gets while the table sizes by content; wider tables scroll. */
export const TABLE_MIN_COLUMN_WIDTH = 64;

type TableResizeDirection = "bottom" | "right";

type TableResizeStartOptions = {
  colIndex: number;
  direction: TableResizeDirection;
  handleKey: string;
  rowIndex: number;
};

type TableResizeDragState = {
  colIndex: number;
  direction: TableResizeDirection;
  initialPosition: number;
  initialSize: number;
  rowIndex: number;
};

export type TableResizeContextValue = {
  /** No column widths saved yet: the table sizes by its content. */
  autoLayout: boolean;
  columnCount: number;
  /** Editable, and no block selection being dragged: rows get grips. */
  hasControls: boolean;
  /**
   * The pointer is over the table, the caret is in it, or an edge is being
   * dragged. Only then do the cells carry their resize handles, which keeps
   * a shard with hundreds of tables light.
   */
  showResizeHandles: boolean;
  /** The whole table is block-selected. */
  isSelectingTable: boolean;
  clearResizePreview: (handleKey: string) => void;
  setResizePreview: (
    event: React.PointerEvent<HTMLDivElement>,
    options: TableResizeStartOptions,
  ) => void;
  startResize: (
    event: React.PointerEvent<HTMLDivElement>,
    options: TableResizeStartOptions,
  ) => void;
};

export const TableResizeContext = React.createContext<TableResizeContextValue | null>(
  null,
);

export function useTableResizeContext() {
  const context = React.useContext(TableResizeContext);

  if (!context) {
    throw new Error("TableResizeContext is missing");
  }

  return context;
}

/**
 * Saved widths, shrunk in proportion when they add up to more than the text
 * column (saved in a wider window, say), so a table never scrolls sideways.
 */
export function fitColSizes(colSizes: number[], fitWidth: number) {
  const total = colSizes.reduce((sum, colSize) => sum + colSize, 0);

  if (fitWidth <= 0 || total <= fitWidth) return colSizes;

  return colSizes.map((colSize) => Math.floor((colSize * fitWidth) / total));
}

/** The element's width, kept current as the window or panels resize. */
export function useElementWidth(ref: React.RefObject<HTMLElement | null>) {
  const [width, setWidth] = React.useState(0);

  React.useLayoutEffect(() => {
    const element = ref.current;

    if (!element) return;

    setWidth(element.clientWidth);
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return width;
}

export function useTableResizeController({
  autoLayout,
  deferColumnResize,
  dragIndicatorRef,
  hoverIndicatorRef,
  controlColumnWidth,
  fitWidth,
  tablePath,
  tableRef,
  wrapperRef,
}: {
  autoLayout: boolean;
  deferColumnResize: boolean;
  dragIndicatorRef: React.RefObject<HTMLDivElement | null>;
  hoverIndicatorRef: React.RefObject<HTMLDivElement | null>;
  controlColumnWidth: number;
  /** The text column's width, which the cells must fit in. */
  fitWidth: number;
  tablePath: number[];
  tableRef: React.RefObject<HTMLTableElement | null>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { editor, getOptions } = useEditorPlugin(TablePlugin);
  const { minColumnWidth = 0 } = getOptions();
  const colSizes = useTableColSizes({
    disableOverrides: true,
  });
  // The widths as shown, so a drag starts from what is on screen.
  const effectiveColSizes = React.useMemo(
    () =>
      fitColSizes(
        colSizes.map((colSize) => colSize || TABLE_DEFAULT_COLUMN_WIDTH),
        fitWidth,
      ),
    [colSizes, fitWidth],
  );
  const effectiveColSizesRef = React.useRef(effectiveColSizes);
  const fitWidthRef = React.useRef(fitWidth);
  const activeHandleKeyRef = React.useRef<string | null>(null);
  const activeRowElementRef = React.useRef<HTMLTableRowElement | null>(null);
  const cleanupListenersRef = React.useRef<(() => void) | null>(null);
  const dragStateRef = React.useRef<TableResizeDragState | null>(null);
  const frozenRowIndicesRef = React.useRef<number[] | null>(null);
  const previewHandleKeyRef = React.useRef<string | null>(null);
  const overrideColSize = useOverrideColSize();
  const overrideRowSize = useOverrideRowSize();
  const [resizing, setResizing] = React.useState(false);

  React.useEffect(() => {
    effectiveColSizesRef.current = effectiveColSizes;
  }, [effectiveColSizes]);

  React.useEffect(() => {
    fitWidthRef.current = fitWidth;
  }, [fitWidth]);

  const hideDeferredResizeIndicator = React.useCallback(() => {
    const indicator = dragIndicatorRef.current;

    if (!indicator) return;

    indicator.style.display = "none";
    indicator.style.removeProperty("left");
  }, [dragIndicatorRef]);

  const showDeferredResizeIndicator = React.useCallback(
    (offset: number) => {
      const indicator = dragIndicatorRef.current;

      if (!indicator) return;

      indicator.style.display = "block";
      indicator.style.left = `${offset}px`;
    },
    [dragIndicatorRef],
  );

  const hideResizeIndicator = React.useCallback(() => {
    const indicator = hoverIndicatorRef.current;

    if (!indicator) return;

    indicator.style.display = "none";
    indicator.style.removeProperty("left");
  }, [hoverIndicatorRef]);

  const clearFrozenRowHeights = React.useCallback(() => {
    const frozenRowIndices = frozenRowIndicesRef.current;

    if (!frozenRowIndices) return;

    frozenRowIndicesRef.current = null;

    frozenRowIndices.forEach((rowIndex) => {
      overrideRowSize(rowIndex, null);
    });
  }, [overrideRowSize]);

  const freezeRowHeights = React.useCallback(() => {
    const table = tableRef.current;

    if (!table || deferColumnResize) return;

    clearFrozenRowHeights();

    const frozenRowIndices: number[] = [];

    Array.from(table.rows).forEach((row, rowIndex) => {
      const height = row.getBoundingClientRect().height;

      if (!height) return;

      overrideRowSize(rowIndex, height);
      frozenRowIndices.push(rowIndex);
    });

    frozenRowIndicesRef.current = frozenRowIndices;
  }, [clearFrozenRowHeights, deferColumnResize, overrideRowSize, tableRef]);

  const showResizeIndicatorAtOffset = React.useCallback(
    (offset: number) => {
      const indicator = hoverIndicatorRef.current;

      if (!indicator) return;

      indicator.style.display = "block";
      indicator.style.left = `${offset}px`;
    },
    [hoverIndicatorRef],
  );

  const showResizeIndicator = React.useCallback(
    ({
      event,
      direction,
    }: Pick<TableResizeStartOptions, "direction"> & {
      event: React.PointerEvent<HTMLDivElement>;
    }) => {
      if (direction === "bottom") return;

      const wrapper = wrapperRef.current;

      if (!wrapper) return;

      const handleRect = event.currentTarget.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const boundaryOffset =
        handleRect.left - wrapperRect.left + handleRect.width / 2;

      showResizeIndicatorAtOffset(boundaryOffset);
    },
    [showResizeIndicatorAtOffset, wrapperRef],
  );

  const setResizePreview = React.useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      options: TableResizeStartOptions,
    ) => {
      if (activeHandleKeyRef.current) return;

      previewHandleKeyRef.current = options.handleKey;
      showResizeIndicator({ ...options, event });
    },
    [showResizeIndicator],
  );

  const clearResizePreview = React.useCallback(
    (handleKey: string) => {
      if (activeHandleKeyRef.current) return;
      if (previewHandleKeyRef.current !== handleKey) return;

      previewHandleKeyRef.current = null;
      hideResizeIndicator();
    },
    [hideResizeIndicator],
  );

  const commitColSize = React.useCallback(
    (colIndex: number, width: number) => {
      setTableColSize(editor, { colIndex, width }, { at: tablePath });
      setTimeout(() => overrideColSize(colIndex, null), 0);
    },
    [editor, overrideColSize, tablePath],
  );

  const commitRowSize = React.useCallback(
    (rowIndex: number, height: number) => {
      setTableRowSize(editor, { height, rowIndex }, { at: tablePath });
      setTimeout(() => overrideRowSize(rowIndex, null), 0);
    },
    [editor, overrideRowSize, tablePath],
  );

  const getColumnBoundaryOffset = React.useCallback(
    (colIndex: number, currentWidth: number) =>
      controlColumnWidth +
      effectiveColSizesRef.current
        .slice(0, colIndex)
        .reduce((total, colSize) => total + colSize, 0) +
      currentWidth,
    [controlColumnWidth],
  );

  const applyResize = React.useCallback(
    (event: PointerEvent, finished: boolean) => {
      const dragState = dragStateRef.current;

      if (!dragState) return;

      const currentPosition =
        dragState.direction === "bottom" ? event.clientY : event.clientX;
      const delta = currentPosition - dragState.initialPosition;

      if (dragState.direction === "bottom") {
        const newHeight = roundCellSizeToStep(
          dragState.initialSize + delta,
          undefined,
        );

        if (finished) {
          commitRowSize(dragState.rowIndex, newHeight);
        } else {
          overrideRowSize(dragState.rowIndex, newHeight);
        }

        return;
      }

      const currentInitial =
        effectiveColSizesRef.current[dragState.colIndex] ??
        dragState.initialSize;
      const nextInitial = effectiveColSizesRef.current[dragState.colIndex + 1];
      const complement = (width: number) =>
        currentInitial + nextInitial - width;
      // The last column grows only up to the edge of the text column.
      const otherColumnsWidth =
        effectiveColSizesRef.current.reduce((sum, colSize) => sum + colSize, 0) -
        currentInitial;
      const lastColumnMax =
        fitWidthRef.current > 0
          ? Math.max(minColumnWidth, fitWidthRef.current - otherColumnsWidth)
          : undefined;
      const currentWidth = roundCellSizeToStep(
        resizeLengthClampStatic(currentInitial + delta, {
          max: nextInitial ? complement(minColumnWidth) : lastColumnMax,
          min: minColumnWidth,
        }),
        undefined,
      );
      const nextWidth = nextInitial ? complement(currentWidth) : undefined;

      if (finished) {
        commitColSize(dragState.colIndex, currentWidth);

        if (nextWidth !== undefined) {
          commitColSize(dragState.colIndex + 1, nextWidth);
        }
      } else if (deferColumnResize) {
        showDeferredResizeIndicator(
          getColumnBoundaryOffset(dragState.colIndex, currentWidth),
        );
      } else {
        showResizeIndicatorAtOffset(
          getColumnBoundaryOffset(dragState.colIndex, currentWidth),
        );
        overrideColSize(dragState.colIndex, currentWidth);

        if (nextWidth !== undefined) {
          overrideColSize(dragState.colIndex + 1, nextWidth);
        }
      }
    },
    [
      commitColSize,
      commitRowSize,
      controlColumnWidth,
      deferColumnResize,
      getColumnBoundaryOffset,
      showDeferredResizeIndicator,
      showResizeIndicatorAtOffset,
      minColumnWidth,
      overrideColSize,
      overrideRowSize,
    ],
  );

  const stopResize = React.useCallback(() => {
    setResizing(false);
    cleanupListenersRef.current?.();
    cleanupListenersRef.current = null;
    activeHandleKeyRef.current = null;
    previewHandleKeyRef.current = null;
    dragStateRef.current = null;

    if (activeRowElementRef.current) {
      delete activeRowElementRef.current.dataset.tableResizing;
      activeRowElementRef.current = null;
    }

    hideDeferredResizeIndicator();
    hideResizeIndicator();
    clearFrozenRowHeights();
  }, [clearFrozenRowHeights, hideDeferredResizeIndicator, hideResizeIndicator]);

  React.useEffect(() => stopResize, [stopResize]);

  /**
   * The first drag of a column edge on a table that sizes by content keeps
   * the widths it has at that moment, so the drag has something to move and
   * the result is saved with the table.
   */
  const freezeMeasuredColSizes = React.useCallback(() => {
    const table = tableRef.current;

    if (!table) return;

    const rows = Array.from(table.rows);
    const widestRow = rows.reduce<HTMLTableRowElement | null>(
      (best, row) => (!best || row.cells.length > best.cells.length ? row : best),
      null,
    );

    if (!widestRow) return;

    const measured: number[] = [];

    Array.from(widestRow.cells).forEach((cell) => {
      // The row handle column is not a table column.
      if (!cell.hasAttribute("data-table-cell-id")) return;

      const span = Math.max(1, cell.colSpan);
      const width = cell.getBoundingClientRect().width / span;

      for (let index = 0; index < span; index += 1) {
        measured.push(Math.max(TABLE_MIN_COLUMN_WIDTH, Math.round(width)));
      }
    });

    if (measured.length === 0) return;

    effectiveColSizesRef.current = measured;
    editor.tf.withoutNormalizing(() => {
      editor.tf.setNodes<TTableElement>({ colSizes: measured }, { at: tablePath });
      editor.tf.unsetNodes("colPercents", { at: tablePath });
    });
  }, [editor, tablePath, tableRef]);

  const startResize = React.useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      { colIndex, direction, handleKey, rowIndex }: TableResizeStartOptions,
    ) => {
      if (autoLayout && direction !== "bottom") {
        freezeMeasuredColSizes();
      } else if (
        direction !== "bottom" &&
        effectiveColSizesRef.current.some(
          (colSize, index) =>
            colSize !== (colSizes[index] || TABLE_DEFAULT_COLUMN_WIDTH),
        )
      ) {
        // Widths shrunk to fit are kept as shown, so the drag moves only
        // the edge being dragged.
        editor.tf.setNodes<TTableElement>(
          { colSizes: effectiveColSizesRef.current },
          { at: tablePath },
        );
      }
      setResizing(true);

      const rowHeight =
        tableRef.current?.rows.item(rowIndex)?.getBoundingClientRect().height ??
        0;

      dragStateRef.current = {
        colIndex,
        direction,
        initialPosition: direction === "bottom" ? event.clientY : event.clientX,
        initialSize:
          direction === "bottom"
            ? rowHeight
            : (effectiveColSizesRef.current[colIndex] ??
              TABLE_DEFAULT_COLUMN_WIDTH),
        rowIndex,
      };
      activeHandleKeyRef.current = handleKey;
      previewHandleKeyRef.current = null;

      const rowElement = tableRef.current?.rows.item(rowIndex) ?? null;

      if (
        activeRowElementRef.current &&
        activeRowElementRef.current !== rowElement
      ) {
        delete activeRowElementRef.current.dataset.tableResizing;
      }

      activeRowElementRef.current = rowElement;

      if (rowElement) {
        rowElement.dataset.tableResizing = "true";
      }

      cleanupListenersRef.current?.();

      if (direction !== "bottom") {
        freezeRowHeights();
      }

      const handlePointerMove = (pointerEvent: PointerEvent) => {
        applyResize(pointerEvent, false);
      };

      const handlePointerEnd = (pointerEvent: PointerEvent) => {
        applyResize(pointerEvent, true);
        stopResize();
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerEnd);
      window.addEventListener("pointercancel", handlePointerEnd);

      cleanupListenersRef.current = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerEnd);
        window.removeEventListener("pointercancel", handlePointerEnd);
      };

      if (deferColumnResize && direction !== "bottom") {
        hideResizeIndicator();
        showDeferredResizeIndicator(
          getColumnBoundaryOffset(
            colIndex,
            effectiveColSizesRef.current[colIndex] ?? TABLE_DEFAULT_COLUMN_WIDTH,
          ),
        );
      } else {
        showResizeIndicator({ direction, event });
      }

      event.preventDefault();
      event.stopPropagation();
    },
    [
      autoLayout,
      colSizes,
      deferColumnResize,
      editor,
      freezeMeasuredColSizes,
      getColumnBoundaryOffset,
      hideResizeIndicator,
      showDeferredResizeIndicator,
      showResizeIndicator,
      stopResize,
      tableRef,
      tablePath,
      applyResize,
      freezeRowHeights,
    ],
  );

  return React.useMemo(
    () => ({
      autoLayout,
      clearResizePreview,
      resizing,
      setResizePreview,
      startResize,
    }),
    [autoLayout, clearResizePreview, resizing, setResizePreview, startResize],
  );
}
