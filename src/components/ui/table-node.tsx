"use client";

import * as React from "react";

import { useDraggable, useDropLine } from "@platejs/dnd";
import {
  BlockSelectionPlugin,
  useBlockSelected,
} from "@platejs/selection/react";
import {
  getTableCellBorders,
  getTableColumnCount,
  setCellBackground,
} from "@platejs/table";
import {
  TablePlugin,
  TableProvider,
  useCellIndices,
  useTableBordersDropdownMenuContentState,
  useTableColSizes,
  useTableElement,
  useTableMergeState,
  useTableSelectionDom,
  useTableValue,
} from "@platejs/table/react";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChartColumnIcon,
  CombineIcon,
  EraserIcon,
  Grid2X2Icon,
  GripVertical,
  PaintBucketIcon,
  SquareSplitHorizontalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type TElement,
  type TTableCellElement,
  type TTableElement,
  type TTableRowElement,
  KEYS,
  PathApi,
} from "platejs";
import {
  type PlateElementProps,
  PlateElement,
  useComposedRef,
  useEditorPlugin,
  useEditorRef,
  useEditorSelector,
  useElement,
  useFocusedLast,
  usePluginOption,
  useReadOnly,
  useRemoveNodeButton,
  useSelected,
  withHOC,
} from "platejs/react";
import { useElementSelector } from "platejs/react";

import {
  type ColumnAlign,
  columnAlignAt,
  setColumnAlign,
} from "@/components/editor/lib/table-align";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { createChartNode, defaultChartSpec, readTable } from "@/lib/chart";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store";

import { useDragControls } from "./block-draggable";
import { blockSelectionVariants } from "./block-selection";
import {
  ColorDropdownMenuItems,
  DEFAULT_COLORS,
} from "./font-color-toolbar-button";
import {
  BorderAllIcon,
  BorderBottomIcon,
  BorderLeftIcon,
  BorderNoneIcon,
  BorderRightIcon,
  BorderTopIcon,
} from "./table-icons";
import {
  TABLE_DEFAULT_COLUMN_WIDTH,
  TABLE_MIN_COLUMN_WIDTH,
  type TableResizeContextValue,
  TableResizeContext,
  fitColSizes,
  useElementWidth,
  useTableResizeContext,
  useTableResizeController,
} from "./table-resize";
import {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenuGroup,
} from "./toolbar";

const TABLE_CONTROL_COLUMN_WIDTH = 8;
const TABLE_DEFERRED_COLUMN_RESIZE_CELL_COUNT = 1200;
const TABLE_MULTI_SELECTION_TOOLBAR_DELAY_MS = 150;

const TableRowContext = React.createContext<{ isSelectingRow: boolean }>({
  isSelectingRow: false,
});
/**
 * A drag is over the table: every row mounts its drop target, since the
 * drop line can show on a row next to the one under the pointer.
 */
const TableDragOverContext = React.createContext(false);

export const TableElement = withHOC(
  TableProvider,
  function TableElement({
    children,
    ...props
  }: PlateElementProps<TTableElement>) {
    const readOnly = useReadOnly();
    const isSelectionAreaVisible = usePluginOption(
      BlockSelectionPlugin,
      "isSelectionAreaVisible",
    );
    const hasControls = !readOnly && !isSelectionAreaVisible;
    const { props: tableProps } = useTableElement();
    const colSizes = useTableColSizes();
    // Markdown carries no column widths, so most tables are as wide as
    // their content, up to the text column. Widths exist once an edge was
    // dragged (or the file's table comment holds them).
    const autoLayout = !props.element.colSizes?.some((size) => size > 0);
    const columnCount = getTableColumnCount(props.element);
    // Widths written by hand as percentages (`widths 30% 30%`) are shares of
    // the text column until an edge is dragged, which switches to pixels.
    const colPercents = props.element.colPercents as number[] | undefined;
    const percentWidths =
      autoLayout && colPercents?.length === columnCount
        ? colPercents
        : null;
    const percentTotal =
      percentWidths?.reduce((total, percent) => total + percent, 0) ?? 0;
    const controlColumnWidth = hasControls ? TABLE_CONTROL_COLUMN_WIDTH : 0;
    const dragIndicatorRef = React.useRef<HTMLDivElement>(null);
    const hoverIndicatorRef = React.useRef<HTMLDivElement>(null);
    const deferColumnResize =
      colSizes.length * props.element.children.length >
      TABLE_DEFERRED_COLUMN_RESIZE_CELL_COUNT;
    // Compared by value: a new path array on every change would rebuild the
    // resize handlers and re-render every cell.
    const tablePath = useElementSelector(([, path]) => path, [], {
      equalityFn: PathApi.equals,
      key: KEYS.table,
    });
    const tableRef = React.useRef<HTMLTableElement>(null);
    const wrapperRef = React.useRef<HTMLDivElement>(null);
    // The wrapper is the text column plus the row grips in the gutter.
    const fitWidth = Math.max(
      0,
      useElementWidth(wrapperRef) - controlColumnWidth,
    );
    useTableSelectionDom(tableRef);
    const resizeController = useTableResizeController({
      autoLayout,
      controlColumnWidth,
      deferColumnResize,
      dragIndicatorRef,
      fitWidth,
      hoverIndicatorRef,
      tablePath,
      tableRef,
      wrapperRef,
    });
    const resolvedColSizes = React.useMemo(
      () =>
        autoLayout
          ? []
          : fitColSizes(
              colSizes.map((colSize) => colSize || TABLE_DEFAULT_COLUMN_WIDTH),
              fitWidth,
            ),
      [autoLayout, colSizes, fitWidth],
    );
    const tableVariableStyle = React.useMemo(() => {
      if (resolvedColSizes.length === 0) {
        return;
      }

      return {
        ...Object.fromEntries(
          resolvedColSizes.map((colSize, index) => [
            `--table-col-${index}`,
            `${colSize}px`,
          ]),
        ),
      } as React.CSSProperties;
    }, [resolvedColSizes]);
    const tableStyle = React.useMemo((): React.CSSProperties | undefined => {
      if (percentWidths) {
        // The wrapper is the text column plus the row grips in the gutter.
        const share = Math.min(100, percentTotal) / 100;
        return {
          width: `calc((100% - ${controlColumnWidth}px) * ${share} + ${controlColumnWidth}px)`,
        };
      }
      if (autoLayout) return;

      return {
        width: `${
          resolvedColSizes.reduce((total, colSize) => total + colSize, 0) +
          controlColumnWidth
        }px`,
      };
    }, [autoLayout, controlColumnWidth, percentTotal, percentWidths, resolvedColSizes]);

    const { isDragOver, shellProps: dragShellProps } =
      useDragControls(wrapperRef);
    const isSelectingTable = useBlockSelected(props.element.id as string);
    const selected = useSelected();
    const [hovered, setHovered] = React.useState(false);
    const showResizeHandles =
      hasControls && (hovered || selected || resizeController.resizing);
    const tableContext = React.useMemo<TableResizeContextValue>(() => {
      const { resizing: _resizing, ...handlers } = resizeController;
      return {
        ...handlers,
        columnCount,
        hasControls,
        isSelectingTable,
        showResizeHandles,
      };
    }, [
      resizeController,
      columnCount,
      hasControls,
      isSelectingTable,
      showResizeHandles,
    ]);

    const content = (
      <PlateElement
        {...props}
        className={cn(
          "overflow-x-auto py-5",
          hasControls && "-ml-2 *:data-[slot=block-selection]:left-2",
        )}
      >
        <TableResizeContext.Provider value={tableContext}>
          <div
            ref={wrapperRef}
            className="group/table relative w-full"
            style={tableVariableStyle}
            {...dragShellProps}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
          >
            <div
              ref={dragIndicatorRef}
              className="-translate-x-[1.5px] pointer-events-none absolute inset-y-0 z-36 hidden w-[3px] bg-ring/70"
              contentEditable={false}
            />
            <div
              ref={hoverIndicatorRef}
              className="-translate-x-[1.5px] pointer-events-none absolute inset-y-0 z-35 hidden w-[3px] bg-ring/80"
              contentEditable={false}
            />
            <table
              ref={tableRef}
              className={cn(
                "table h-px border-collapse",
                autoLayout && !percentWidths ? "table-auto" : "table-fixed",
                "data-[table-selecting=true]:[&_*::selection]:!bg-transparent",
                "data-[table-selecting=true]:[&_*::selection]:!text-inherit",
                "data-[table-selecting=true]:[&_*::-moz-selection]:!bg-transparent",
                "data-[table-selecting=true]:[&_*::-moz-selection]:!text-inherit",
                "data-[table-selecting=true]:[&_*]:!caret-transparent",
              )}
              style={tableStyle}
              {...tableProps}
            >
              {(hasControls || resolvedColSizes.length > 0 || percentWidths) && (
                <colgroup>
                  {hasControls && (
                    <col
                      style={{
                        maxWidth: TABLE_CONTROL_COLUMN_WIDTH,
                        minWidth: TABLE_CONTROL_COLUMN_WIDTH,
                        width: TABLE_CONTROL_COLUMN_WIDTH,
                      }}
                    />
                  )}
                  {percentWidths?.map((percent, index) => (
                    <col
                      key={index}
                      style={{ width: `${(percent / percentTotal) * 100}%` }}
                    />
                  ))}
                  {resolvedColSizes.map((colSize, index) => (
                    <col
                      key={index}
                      style={{
                        maxWidth: colSize,
                        minWidth: colSize,
                        width: colSize,
                      }}
                    />
                  ))}
                </colgroup>
              )}
              <tbody className="min-w-full">
                <TableDragOverContext.Provider value={isDragOver}>
                  {children}
                </TableDragOverContext.Provider>
              </tbody>
            </table>

            {isSelectingTable && (
              <div
                className={blockSelectionVariants()}
                contentEditable={false}
              />
            )}
            {selected && <TableSelectionDom tableRef={tableRef} />}
          </div>
        </TableResizeContext.Provider>
      </PlateElement>
    );

    if (readOnly) {
      return content;
    }

    return <TableFloatingToolbar>{content}</TableFloatingToolbar>;
  },
);

/**
 * Marks the cells the selection covers in the DOM. Only a table holding the
 * caret watches the selection; when the caret leaves, the marks go with it.
 */
function TableSelectionDom({
  tableRef,
}: {
  tableRef: React.RefObject<HTMLTableElement | null>;
}) {
  useTableSelectionDom(tableRef);

  React.useEffect(
    () => () => {
      const table = tableRef.current;
      if (!table) return;
      table.removeAttribute("data-table-selecting");
      for (const cell of table.querySelectorAll("[data-table-cell-selected]")) {
        cell.removeAttribute("data-table-cell-selected");
      }
    },
    [tableRef],
  );

  return null;
}

type TableToolbarKind = "collapsed" | "expanded" | "none";

function TableFloatingToolbar({
  children,
  ...props
}: React.ComponentProps<typeof PopoverContent>) {
  const selected = useSelected();
  const [kind, setKind] = React.useState<TableToolbarKind>("none");
  // The menu is drawn over the whole window, so it waits while Settings or
  // another view covers the shard.
  const editorOnScreen = useUIStore(
    (s) => s.appMode === "notes" && s.activeNavItem !== "settings",
  );
  const open = selected && editorOnScreen && kind !== "none";

  return (
    <Popover open={open} modal={false}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      {selected && <TableFloatingToolbarState onChange={setKind} />}
      {open && kind === "collapsed" && (
        <CollapsedTableFloatingToolbarContent {...props} />
      )}
      {open && kind === "expanded" && (
        <ExpandedSelectionTableFloatingToolbarContent {...props} />
      )}
    </Popover>
  );
}

/**
 * Follows the selection while the caret is in the table. A table without
 * the caret has nothing to follow, so it subscribes to nothing: with
 * hundreds of tables in a shard, that is what keeps typing quick.
 */
function TableFloatingToolbarState({
  onChange,
}: {
  onChange: (kind: TableToolbarKind) => void;
}) {
  const selectedCellCount = useEditorSelector(
    (editor) =>
      editor.getApi(TablePlugin).table.getSelectedCellIds()?.length ?? 0,
    [],
  );
  const collapsedInside = useEditorSelector(
    (editor) => editor.api.isCollapsed(),
    [],
  );
  const isFocusedLast = useFocusedLast();
  const [isExpandedSelectionToolbarReady, setIsExpandedSelectionToolbarReady] =
    React.useState(false);
  const isCollapsedToolbarOpen = isFocusedLast && collapsedInside;
  const isExpandedSelectionPending =
    isFocusedLast && !collapsedInside && selectedCellCount > 1;

  React.useEffect(() => {
    if (!isExpandedSelectionPending) {
      setIsExpandedSelectionToolbarReady(false);

      return;
    }

    const timeoutId = window.setTimeout(() => {
      setIsExpandedSelectionToolbarReady(true);
    }, TABLE_MULTI_SELECTION_TOOLBAR_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isExpandedSelectionPending]);

  const kind: TableToolbarKind = isCollapsedToolbarOpen
    ? "collapsed"
    : isExpandedSelectionToolbarReady && isExpandedSelectionPending
      ? "expanded"
      : "none";

  React.useEffect(() => {
    onChange(kind);
  }, [kind, onChange]);
  React.useEffect(() => () => onChange("none"), [onChange]);

  return null;
}

function ExpandedSelectionTableFloatingToolbarContent(
  props: React.ComponentProps<typeof PopoverContent>,
) {
  const { tf } = useEditorPlugin(TablePlugin);
  const { canMerge, canSplit } = useTableMergeState();

  if (!canMerge && !canSplit) return null;

  return (
    <TableFloatingToolbarContent
      canMerge={canMerge}
      canSplit={canSplit}
      onMerge={() => tf.table.merge()}
      onSplit={() => tf.table.split()}
      {...props}
    />
  );
}

function CollapsedTableFloatingToolbarContent(
  props: React.ComponentProps<typeof PopoverContent>,
) {
  const { editor, tf } = useEditorPlugin(TablePlugin);
  const element = useElement<TTableElement>();
  const { props: buttonProps } = useRemoveNodeButton({ element });
  const { canSplit } = useTableMergeState();

  return (
    <TableFloatingToolbarContent
      buttonProps={buttonProps}
      onAddChart={() => {
        const path = editor.api.findPath(element);
        if (!path) return;
        editor.tf.insertNodes(
          createChartNode(defaultChartSpec(readTable(element))),
          { at: PathApi.next(path), select: true },
        );
      }}
      canSplit={canSplit}
      collapsedInside
      onDeleteColumn={() => {
        tf.remove.tableColumn();
      }}
      onDeleteRow={() => {
        tf.remove.tableRow();
      }}
      onInsertColumnAfter={() => {
        tf.insert.tableColumn();
      }}
      onInsertColumnBefore={() => {
        tf.insert.tableColumn({ before: true });
      }}
      onInsertRowAfter={() => {
        tf.insert.tableRow();
      }}
      onInsertRowBefore={() => {
        tf.insert.tableRow({ before: true });
      }}
      onSplit={() => tf.table.split()}
      {...props}
    />
  );
}

function TableFloatingToolbarContent({
  buttonProps,
  onAddChart,
  canMerge = false,
  canSplit = false,
  collapsedInside = false,
  onDeleteColumn,
  onDeleteRow,
  onInsertColumnAfter,
  onInsertColumnBefore,
  onInsertRowAfter,
  onInsertRowBefore,
  onMerge,
  onSplit,
  ...props
}: React.ComponentProps<typeof PopoverContent> & {
  buttonProps?: React.ComponentProps<typeof ToolbarButton>;
  /** Draws the table as a chart under it. */
  onAddChart?: () => void;
  canMerge?: boolean;
  canSplit?: boolean;
  collapsedInside?: boolean;
  onDeleteColumn?: () => void;
  onDeleteRow?: () => void;
  onInsertColumnAfter?: () => void;
  onInsertColumnBefore?: () => void;
  onInsertRowAfter?: () => void;
  onInsertRowBefore?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
}) {
  return (
    <PopoverContent
      asChild
      onOpenAutoFocus={(e) => e.preventDefault()}
      contentEditable={false}
      {...props}
    >
      <Toolbar
        className="scrollbar-hide flex w-auto max-w-[80vw] flex-row overflow-x-auto rounded-md border bg-popover p-1 shadow-md print:hidden"
        contentEditable={false}
      >
        <ToolbarGroup>
          <ColorDropdownMenu tooltip="Background color">
            <PaintBucketIcon />
          </ColorDropdownMenu>
          <ColumnAlignDropdownMenu />
          {canMerge && onMerge && (
            <ToolbarButton
              onClick={onMerge}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Merge cells"
            >
              <CombineIcon />
            </ToolbarButton>
          )}
          {canSplit && onSplit && (
            <ToolbarButton
              onClick={onSplit}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Split cell"
            >
              <SquareSplitHorizontalIcon />
            </ToolbarButton>
          )}

          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <ToolbarButton tooltip="Cell borders">
                <Grid2X2Icon />
              </ToolbarButton>
            </DropdownMenuTrigger>

            <DropdownMenuPortal>
              <TableBordersDropdownMenuContent />
            </DropdownMenuPortal>
          </DropdownMenu>

          {collapsedInside && (
            <ToolbarGroup>
              {onAddChart ? (
                <ToolbarButton
                  onClick={onAddChart}
                  onMouseDown={(e) => e.preventDefault()}
                  tooltip="Add a chart of this table"
                  aria-label="Add a chart of this table"
                >
                  <ChartColumnIcon />
                </ToolbarButton>
              ) : null}
              <ToolbarButton tooltip="Delete table" {...buttonProps}>
                <Trash2Icon />
              </ToolbarButton>
            </ToolbarGroup>
          )}
        </ToolbarGroup>

        {collapsedInside && (
          <ToolbarGroup>
            <ToolbarButton
              onClick={onInsertRowBefore}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Insert row before"
            >
              <ArrowUp />
            </ToolbarButton>
            <ToolbarButton
              onClick={onInsertRowAfter}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Insert row after"
            >
              <ArrowDown />
            </ToolbarButton>
            <ToolbarButton
              onClick={onDeleteRow}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Delete row"
            >
              <XIcon />
            </ToolbarButton>
          </ToolbarGroup>
        )}

        {collapsedInside && (
          <ToolbarGroup>
            <ToolbarButton
              onClick={onInsertColumnBefore}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Insert column before"
            >
              <ArrowLeft />
            </ToolbarButton>
            <ToolbarButton
              onClick={onInsertColumnAfter}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Insert column after"
            >
              <ArrowRight />
            </ToolbarButton>
            <ToolbarButton
              onClick={onDeleteColumn}
              onMouseDown={(e) => e.preventDefault()}
              tooltip="Delete column"
            >
              <XIcon />
            </ToolbarButton>
          </ToolbarGroup>
        )}
      </Toolbar>
    </PopoverContent>
  );
}

function TableBordersDropdownMenuContent(
  props: React.ComponentProps<typeof DropdownMenuContent>,
) {
  const editor = useEditorRef();
  const {
    getOnSelectTableBorder,
    hasBottomBorder,
    hasLeftBorder,
    hasNoBorders,
    hasOuterBorders,
    hasRightBorder,
    hasTopBorder,
  } = useTableBordersDropdownMenuContentState();

  return (
    <DropdownMenuContent
      className="min-w-[220px]"
      onCloseAutoFocus={(e) => {
        e.preventDefault();
        editor.tf.focus();
      }}
      align="start"
      side="right"
      sideOffset={0}
      {...props}
    >
      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={hasTopBorder}
          onCheckedChange={getOnSelectTableBorder("top")}
        >
          <BorderTopIcon />
          <div>Top border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasRightBorder}
          onCheckedChange={getOnSelectTableBorder("right")}
        >
          <BorderRightIcon />
          <div>Right border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasBottomBorder}
          onCheckedChange={getOnSelectTableBorder("bottom")}
        >
          <BorderBottomIcon />
          <div>Bottom border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasLeftBorder}
          onCheckedChange={getOnSelectTableBorder("left")}
        >
          <BorderLeftIcon />
          <div>Left border</div>
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>

      <DropdownMenuGroup>
        <DropdownMenuCheckboxItem
          checked={hasNoBorders}
          onCheckedChange={getOnSelectTableBorder("none")}
        >
          <BorderNoneIcon />
          <div>No border</div>
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={hasOuterBorders}
          onCheckedChange={getOnSelectTableBorder("outer")}
        >
          <BorderAllIcon />
          <div>Outside borders</div>
        </DropdownMenuCheckboxItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

function ColorDropdownMenu({
  children,
  tooltip,
}: {
  children: React.ReactNode;
  tooltip: string;
}) {
  const [open, setOpen] = React.useState(false);

  const editor = useEditorRef();

  const onUpdateColor = React.useCallback(
    (color: string) => {
      setOpen(false);
      setCellBackground(editor, {
        color,
        selectedCells:
          editor.getApi(TablePlugin).table.getSelectedCells() ?? [],
      });
    },
    [editor],
  );

  const onClearColor = React.useCallback(() => {
    setOpen(false);
    setCellBackground(editor, {
      color: null,
      selectedCells: editor.getApi(TablePlugin).table.getSelectedCells() ?? [],
    });
  }, [editor]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton tooltip={tooltip}>{children}</ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <ToolbarMenuGroup label="Colors">
          <ColorDropdownMenuItems
            className="px-2"
            colors={DEFAULT_COLORS}
            updateColor={onUpdateColor}
          />
        </ToolbarMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuItem className="p-2" onClick={onClearColor}>
            <EraserIcon />
            <span>Clear</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const COLUMN_ALIGNS: {
  value: ColumnAlign;
  label: string;
  icon: typeof AlignLeftIcon;
}[] = [
  { value: "left", label: "Left", icon: AlignLeftIcon },
  { value: "center", label: "Center", icon: AlignCenterIcon },
  { value: "right", label: "Right", icon: AlignRightIcon },
];

/** Aligns the columns the selection touches, as the saved table does. */
function ColumnAlignDropdownMenu() {
  const [open, setOpen] = React.useState(false);
  const editor = useEditorRef();
  const value = useEditorSelector((editor) => columnAlignAt(editor), []);
  const Icon =
    COLUMN_ALIGNS.find((item) => item.value === value)?.icon ?? AlignLeftIcon;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <ToolbarButton tooltip="Align column" aria-label="Align column">
          <Icon />
        </ToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            setColumnAlign(editor, next as ColumnAlign);
            editor.tf.focus();
          }}
        >
          {COLUMN_ALIGNS.map(({ value: itemValue, label, icon: ItemIcon }) => (
            <DropdownMenuRadioItem key={itemValue} value={itemValue}>
              <ItemIcon />
              <span>{label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TableRowElement({
  children,
  ...props
}: PlateElementProps<TTableRowElement>) {
  const { hasControls, isSelectingTable } = useTableResizeContext();
  const isSelectingRow = useBlockSelected() || isSelectingTable;
  const rowContext = React.useMemo(() => ({ isSelectingRow }), [isSelectingRow]);
  const rowIndex = useElementSelector(([, path]) => path.at(-1) as number, [], {
    key: KEYS.tr,
  });
  const rowSize = useElementSelector(
    ([node]) => (node as TTableRowElement).size,
    [],
    {
      key: KEYS.tr,
    },
  );
  const rowSizeOverrides = useTableValue("rowSizeOverrides");
  const rowMinHeight = rowSizeOverrides.get?.(rowIndex) ?? rowSize;
  const rowRef = React.useRef<HTMLTableRowElement>(null);
  const { isActive, isDragging, onDraggingChange, shellProps } =
    useDragControls(rowRef);
  const isTableDragOver = React.useContext(TableDragOverContext);

  return (
    <PlateElement
      {...props}
      ref={useComposedRef(props.ref, rowRef)}
      as="tr"
      className={cn("group/row", isDragging && "opacity-50")}
      style={
        {
          ...props.style,
          "--tableRowMinHeight": rowMinHeight ? `${rowMinHeight}px` : undefined,
        } as React.CSSProperties
      }
      // Plate passes only `attributes` on to the row's <tr>.
      attributes={{ ...props.attributes, ...(hasControls ? shellProps : {}) }}
    >
      {hasControls && (
        <td
          className="w-2 min-w-2 max-w-2 select-none p-0"
          contentEditable={false}
        >
          {(isActive || isTableDragOver) && (
            <RowDragControls
              onDraggingChange={onDraggingChange}
              rowRef={rowRef}
            />
          )}
        </td>
      )}

      <TableRowContext.Provider value={rowContext}>{children}</TableRowContext.Provider>
    </PlateElement>
  );
}

/** The row's grip, drag source and drop target; mounted only while needed. */
function RowDragControls({
  onDraggingChange,
  rowRef,
}: {
  onDraggingChange: (dragging: boolean) => void;
  rowRef: React.RefObject<HTMLTableRowElement | null>;
}) {
  const editor = useEditorRef();
  const element = useElement<TTableRowElement>();
  const { isDragging, nodeRef, previewRef, handleRef } = useDraggable({
    element,
    type: element.type,
    canDropNode: ({ dragEntry, dropEntry }) =>
      !!dragEntry &&
      PathApi.equals(
        PathApi.parent(dragEntry[1]),
        PathApi.parent(dropEntry[1]),
      ),
    onDropHandler: (_, { dragItem }) => {
      const dragElement = (dragItem as { element: TElement }).element;

      if (dragElement) {
        editor.tf.select(dragElement);
      }
    },
  });

  // The row the shell already rendered is the drop target and drag preview.
  if (nodeRef) nodeRef.current = rowRef.current;
  if (previewRef) previewRef.current = rowRef.current;

  const wasDraggingRef = React.useRef(false);

  React.useEffect(() => {
    // Only report real changes: these controls also mount mid-drag on rows
    // being dragged over.
    if (!!isDragging !== wasDraggingRef.current) {
      wasDraggingRef.current = !!isDragging;
      onDraggingChange(!!isDragging);
    }
  }, [isDragging, onDraggingChange]);

  return (
    <>
      <RowDragHandle dragRef={handleRef} />
      <RowDropLine />
    </>
  );
}

function useTableCellPresentation(element: TTableCellElement) {
  const { api, editor } = useEditorPlugin(TablePlugin);
  const cellIndices = useCellIndices();
  const { col, row } = cellIndices;
  const borders = React.useMemo(
    () => getTableCellBorders(editor, { cellIndices, element }),
    [cellIndices, editor, element],
  );

  const colSpan = api.table.getColSpan(element);
  const rowSpan = api.table.getRowSpan(element);
  const width = React.useMemo(() => {
    const terms = Array.from(
      { length: colSpan },
      (_, offset) => `var(--table-col-${col + offset}, 120px)`,
    );

    return terms.length === 1 ? terms[0]! : `calc(${terms.join(" + ")})`;
  }, [col, colSpan]);

  return {
    borders,
    colIndex: col + colSpan - 1,
    colSpan,
    rowIndex: row + rowSpan - 1,
    rowSpan,
    width,
  };
}

function RowDragHandle({ dragRef }: { dragRef: React.Ref<any> }) {
  const editor = useEditorRef();
  const element = useElement();

  return (
    <Button
      ref={dragRef}
      variant="outline"
      className={cn(
        "-translate-y-1/2 absolute top-1/2 left-0 z-51 h-6 w-4 p-0 focus-visible:ring-0 focus-visible:ring-offset-0",
        "cursor-grab active:cursor-grabbing",
        "opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-data-[table-resizing=true]/row:opacity-0",
      )}
      onClick={() => {
        editor.tf.select(element);
      }}
    >
      <GripVertical className="text-muted-foreground" />
    </Button>
  );
}

function RowDropLine() {
  const { dropLine } = useDropLine();

  if (!dropLine) return null;

  return (
    <div
      className={cn(
        "absolute inset-x-0 left-2 z-50 h-0.5 bg-brand/50",
        dropLine === "top" ? "-top-px" : "-bottom-px",
      )}
    />
  );
}

export function TableCellElement({
  isHeader,
  ...props
}: PlateElementProps<TTableCellElement> & {
  isHeader?: boolean;
}) {
  const element = props.element;
  // What the table and row already know is read from them, not looked up
  // again in every cell.
  const { autoLayout, columnCount, showResizeHandles } =
    useTableResizeContext();
  const { isSelectingRow } = React.useContext(TableRowContext);

  const { borders, colIndex, colSpan, rowIndex, rowSpan, width } =
    useTableCellPresentation(element);

  return (
    <PlateElement
      {...props}
      as={isHeader ? "th" : "td"}
      className={cn(
        "relative h-full overflow-visible border-none bg-background p-0",
        element.background ? "bg-(--cellBackground)" : "bg-background",
        isHeader && "text-left *:m-0",
        "before:size-full",
        "data-[table-cell-selected=true]:before:z-10",
        "data-[table-cell-selected=true]:before:bg-brand/5",
        "before:absolute before:box-border before:select-none before:content-['']",
        borders.bottom?.size && "before:border-b before:border-b-border",
        borders.right?.size && "before:border-r before:border-r-border",
        borders.left?.size && "before:border-l before:border-l-border",
        borders.top?.size && "before:border-t before:border-t-border",
      )}
      style={
        {
          "--cellBackground": element.background,
          ...(autoLayout
            ? { minWidth: TABLE_MIN_COLUMN_WIDTH * colSpan }
            : { maxWidth: width, minWidth: width }),
        } as unknown as React.CSSProperties
      }
      attributes={{
        ...props.attributes,
        colSpan,
        "data-table-cell-id": element.id,
        rowSpan,
      }}
    >
      <div
        // Long links (URLs) wrap instead of widening the table.
        className="relative z-20 box-border h-full px-3 py-2 [&_a]:[overflow-wrap:anywhere]"
        style={
          rowSpan === 1
            ? { minHeight: "var(--tableRowMinHeight, 0px)" }
            : undefined
        }
      >
        {props.children}
      </div>

      {showResizeHandles && (
        <TableCellResizeControls
          colIndex={colIndex}
          isLastColumn={colIndex === columnCount - 1}
          rowIndex={rowIndex}
        />
      )}

      {isSelectingRow && (
        <div className={blockSelectionVariants()} contentEditable={false} />
      )}
    </PlateElement>
  );
}

export function TableCellHeaderElement(
  props: React.ComponentProps<typeof TableCellElement>,
) {
  return <TableCellElement {...props} isHeader />;
}

const TableCellResizeControls = React.memo(function TableCellResizeControls({
  colIndex,
  isLastColumn,
  rowIndex,
}: {
  colIndex: number;
  /** The last column's edge stays inside the table, so it never scrolls. */
  isLastColumn: boolean;
  rowIndex: number;
}) {
  const {
    clearResizePreview,
    setResizePreview,
    startResize,
  } = useTableResizeContext();
  const rightHandleKey = `right:${rowIndex}:${colIndex}`;
  const bottomHandleKey = `bottom:${rowIndex}:${colIndex}`;

  return (
    <div
      className="group/resize pointer-events-none absolute inset-0 z-30 select-none"
      contentEditable={false}
      suppressContentEditableWarning={true}
    >
      <div
        className={cn(
          "-top-2 pointer-events-auto absolute z-40 h-[calc(100%_+_8px)] w-2 cursor-col-resize touch-none",
          isLastColumn ? "right-0" : "-right-1",
        )}
        onPointerEnter={(event) => {
          setResizePreview(event, {
            colIndex,
            direction: "right",
            handleKey: rightHandleKey,
            rowIndex,
          });
        }}
        onPointerLeave={() => {
          clearResizePreview(rightHandleKey);
        }}
        onPointerDown={(event) => {
          startResize(event, {
            colIndex,
            direction: "right",
            handleKey: rightHandleKey,
            rowIndex,
          });
        }}
      />
      <div
        className="-bottom-1 pointer-events-auto absolute left-0 z-40 h-2 w-full cursor-row-resize touch-none"
        onPointerEnter={(event) => {
          setResizePreview(event, {
            colIndex,
            direction: "bottom",
            handleKey: bottomHandleKey,
            rowIndex,
          });
        }}
        onPointerLeave={() => {
          clearResizePreview(bottomHandleKey);
        }}
        onPointerDown={(event) => {
          startResize(event, {
            colIndex,
            direction: "bottom",
            handleKey: bottomHandleKey,
            rowIndex,
          });
        }}
      />
    </div>
  );
});

TableCellResizeControls.displayName = "TableCellResizeControls";
