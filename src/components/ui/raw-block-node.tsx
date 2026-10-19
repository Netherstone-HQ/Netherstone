"use client";

import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import { isChartComment } from "@/lib/chart";
import type { TRawBlockElement } from "@/lib/markdown-raw-blocks";

import { ChartBlock } from "./chart-node";
import { VerbatimBlock } from "./verbatim-block";

/**
 * HTML the editor has no block for, shown and saved exactly as written. A
 * chart's comment is drawn as the chart.
 */
export function RawBlockElement(props: PlateElementProps<TRawBlockElement>) {
  const value = props.element.value;
  if (isChartComment(value)) {
    return (
      <PlateElement {...props}>
        <ChartBlock element={props.element} path={props.path} />
        {props.children}
      </PlateElement>
    );
  }

  const label = value.trimStart().startsWith("<!--") ? "Comment" : "HTML";

  return (
    <PlateElement {...props}>
      <VerbatimBlock label={label} lines={value.split(/\r?\n/)} />
      {props.children}
    </PlateElement>
  );
}
