"use client";

import { useMemo, useRef, useState } from "react";
import { CodeIcon, CopyIcon, PencilIcon } from "lucide-react";
import { NodeApi, type Path, type TElement } from "platejs";
import {
  useEditorRef,
  useEditorSelector,
  useFocused,
  useReadOnly,
  useSelected,
} from "platejs/react";
import { toast } from "sonner";

import { ChartSvg, SERIES_CLASSES } from "@/components/data/ChartSvg";
import { DrawingIcon } from "@/components/icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MAX_SERIES,
  chartData,
  isTableNode,
  numericColumns,
  parseChartComment,
  readTable,
  serializeChartComment,
  type ChartData,
  type ChartSpec,
} from "@/lib/chart";
import { blobToDataUrl, chartPng, drawingWithImage } from "@/lib/chart-image";
import { createDrawingFile, saveDrawingFile, scanVault } from "@/lib/commands";
import { openDrawingFile } from "@/lib/open-vault-file";
import type { TRawBlockElement } from "@/lib/markdown-raw-blocks";
import { cn } from "@/lib/utils";
import { useEditorStore, useVaultStore } from "@/store";

import { VerbatimBlock } from "./verbatim-block";

/** The table right above the block at `path`, or null when there isn't one. */
function tableAbove(editor: { children: unknown[] }, path: Path) {
  const index = path[path.length - 1];
  if (index === 0) return null;
  const node = NodeApi.get(editor as never, [...path.slice(0, -1), index - 1]);
  return isTableNode(node) ? (node as TElement) : null;
}

function chartTitle(spec: ChartSpec, data: ChartData, x: string | undefined) {
  if (spec.title) return spec.title;
  const names = data.series.map((s) => s.name).join(", ");
  return x ? `${names} by ${x}` : names;
}

const TOOLBAR_BUTTON =
  "inline-flex h-7 items-center gap-1.5 rounded-sm px-2 font-medium text-ui-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-accent aria-pressed:bg-accent [&_svg]:size-3.5";

function ChartSettings({
  spec,
  columns,
  numbers,
  onChange,
}: {
  spec: ChartSpec;
  columns: string[];
  numbers: string[];
  onChange: (spec: ChartSpec) => void;
}) {
  const x = spec.x ?? columns[0] ?? "";
  const drawn =
    spec.y.length > 0 ? spec.y : numbers.filter((n) => n !== x).slice(0, 1);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chart-kind">Chart</Label>
        <div
          id="chart-kind"
          role="radiogroup"
          className="inline-flex gap-0.5 self-start rounded-md border p-0.5"
        >
          {(["bar", "line"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              role="radio"
              aria-checked={spec.kind === kind}
              onClick={() => onChange({ ...spec, kind })}
              className="h-6 rounded-sm px-2.5 font-medium text-muted-foreground text-ui-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-accent aria-checked:text-foreground"
            >
              {kind === "bar" ? "Bars" : "Line"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chart-x">Along the bottom</Label>
        <Select
          value={x}
          onValueChange={(next) =>
            onChange({ ...spec, x: next, y: drawn.filter((n) => n !== next) })
          }
        >
          <SelectTrigger id="chart-x" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {columns.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 font-medium text-ui-sm">Numbers</legend>
        {numbers.filter((n) => n !== x).length === 0 ? (
          <p className="text-muted-foreground text-ui-sm">
            No other column holds only numbers.
          </p>
        ) : (
          numbers
            .filter((n) => n !== x)
            .map((column) => {
              const checked = drawn.includes(column);
              const full = !checked && drawn.length >= MAX_SERIES;
              return (
                <label
                  key={column}
                  className={cn(
                    "flex items-center gap-2 text-ui-sm",
                    full && "opacity-50",
                  )}
                >
                  <Checkbox
                    checked={checked}
                    disabled={full || (checked && drawn.length === 1)}
                    onCheckedChange={(on) =>
                      onChange({
                        ...spec,
                        y: on
                          ? [...drawn, column]
                          : drawn.filter((n) => n !== column),
                      })
                    }
                  />
                  {column}
                </label>
              );
            })
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="chart-title">Title</Label>
        <Input
          id="chart-title"
          value={spec.title}
          placeholder="Named after its columns"
          onChange={(e) => onChange({ ...spec, title: e.target.value })}
          className="h-8 text-ui-sm"
        />
      </div>
    </div>
  );
}

/**
 * A chart of the table above it, with Edit, Copy as image, Send to Canvas
 * and Show Markdown. It's a raw block like any other comment, so it saves as
 * written; edits rewrite its comment.
 */
export function ChartBlock({
  element,
  path,
}: {
  element: TRawBlockElement;
  path: Path;
}) {
  const editor = useEditorRef();
  const readOnly = useReadOnly();
  const selected = useSelected();
  const focused = useFocused();
  const svgRef = useRef<SVGSVGElement>(null);
  const [showMarkdown, setShowMarkdown] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const spec = useMemo(() => parseChartComment(element.value), [element.value]);
  // Redraws when the table above changes, and only then.
  const table = useEditorSelector((ed) => tableAbove(ed, path), [path]);
  const tableData = useMemo(() => (table ? readTable(table) : null), [table]);
  const data = useMemo(
    () => (spec && tableData ? chartData(spec, tableData) : null),
    [spec, tableData],
  );

  if (!spec) return null;

  const setSpec = (next: ChartSpec) => {
    editor.tf.setNodes<TRawBlockElement>(
      { value: serializeChartComment(next) },
      { at: path },
    );
  };

  const x = tableData ? (spec.x ?? tableData.columns[0]) : undefined;
  const title = data ? chartTitle(spec, data, x) : "Chart";
  const canDraw = !!data && data.series.length > 0 && data.labels.length > 0;

  async function picture() {
    const svg = svgRef.current;
    if (!svg) throw new Error("The chart isn't drawn");
    const background = getComputedStyle(
      svg.closest("[data-chart]") ?? svg,
    ).backgroundColor;
    const legend = (data?.series ?? []).map((s, i) => ({
      name: s.name,
      color: getComputedStyle(svg.querySelector(`[data-series="${i}"]`) ?? svg)
        .fill,
    }));
    return chartPng(svg, { background, title, legend });
  }

  async function copyImage() {
    try {
      const { blob } = await picture();
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      toast.success("Chart copied as an image");
    } catch (error) {
      console.error("[Netherstone] Failed to copy chart:", error);
      toast.error("Couldn't copy the chart");
    }
  }

  async function sendToCanvas() {
    const shardPath = useEditorStore.getState().currentFilePath;
    const vaultPath = useVaultStore.getState().currentVaultPath;
    if (!shardPath || !vaultPath) return;
    try {
      const { blob, width, height } = await picture();
      const folder = shardPath.replace(/[\\/][^\\/]*$/, "");
      const drawingPath = await createDrawingFile(folder, title);
      await saveDrawingFile(
        drawingPath,
        drawingWithImage({
          dataUrl: await blobToDataUrl(blob),
          width: Math.round(width),
          height: Math.round(height),
        }),
      );
      useVaultStore.getState().setFileTree(await scanVault(vaultPath));
      await openDrawingFile(drawingPath);
    } catch (error) {
      console.error("[Netherstone] Failed to send chart to Canvas:", error);
      toast.error("Couldn't send the chart to Canvas");
    }
  }

  return (
    <div
      data-chart
      contentEditable={false}
      className={cn(
        "group/chart relative my-3 rounded-lg border bg-card px-4 pt-3.5 pb-3",
        selected && focused && "ring-2 ring-ring ring-offset-2",
      )}
    >
      {!readOnly ? (
        <div
          role="toolbar"
          aria-label="Chart"
          className={cn(
            "absolute -top-4 right-2.5 z-10 flex gap-0.5 rounded-md border bg-popover p-0.5 shadow-md transition-opacity",
            isEditing || (selected && focused)
              ? "opacity-100"
              : "pointer-events-none opacity-0 group-focus-within/chart:pointer-events-auto group-focus-within/chart:opacity-100 group-hover/chart:pointer-events-auto group-hover/chart:opacity-100",
          )}
        >
          {tableData ? (
            <Popover open={isEditing} onOpenChange={setIsEditing}>
              <PopoverTrigger asChild>
                <button type="button" className={TOOLBAR_BUTTON}>
                  <PencilIcon />
                  Edit
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64">
                <ChartSettings
                  spec={spec}
                  columns={tableData.columns}
                  numbers={numericColumns(tableData)}
                  onChange={setSpec}
                />
              </PopoverContent>
            </Popover>
          ) : null}
          {canDraw ? (
            <>
              <button
                type="button"
                className={TOOLBAR_BUTTON}
                onClick={() => void copyImage()}
              >
                <CopyIcon />
                Copy as image
              </button>
              <button
                type="button"
                className={TOOLBAR_BUTTON}
                onClick={() => void sendToCanvas()}
              >
                <DrawingIcon />
                Send to Canvas
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-pressed={showMarkdown}
            className={TOOLBAR_BUTTON}
            onClick={() => setShowMarkdown((shown) => !shown)}
          >
            <CodeIcon />
            {showMarkdown ? "Hide Markdown" : "Show Markdown"}
          </button>
        </div>
      ) : null}

      <div className="mb-2.5 flex items-baseline gap-2">
        <span className="font-medium text-ui-sm">{title}</span>
        {canDraw ? (
          <span className="text-muted-foreground text-ui-sm">
            from the table above
          </span>
        ) : null}
      </div>

      {canDraw && data ? (
        <>
          <ChartSvg ref={svgRef} kind={spec.kind} data={data} label={title} />
          {data.series.length > 1 ? (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-ui-sm">
              {data.series.map((s, i) => (
                <span key={s.name} className="flex items-center gap-1.5">
                  <span
                    className={cn("size-2.5 rounded-sm", SERIES_CLASSES[i])}
                  />
                  {s.name}
                </span>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-muted-foreground text-ui-sm">
          {tableData
            ? "The table above needs a column of numbers to draw."
            : "A chart draws the table right above it. Move it under a table."}
        </p>
      )}

      {showMarkdown ? (
        <VerbatimBlock label="Markdown" lines={[element.value]} />
      ) : null}
    </div>
  );
}
