"use client";

import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import type { TRawBlockElement } from "@/lib/markdown-raw-blocks";

import { VerbatimBlock } from "./verbatim-block";

/** HTML the editor has no block for, shown and saved exactly as written. */
export function RawBlockElement(props: PlateElementProps<TRawBlockElement>) {
  const value = props.element.value;
  const label = value.trimStart().startsWith("<!--") ? "Comment" : "HTML";

  return (
    <PlateElement {...props}>
      <VerbatimBlock label={label} lines={value.split(/\r?\n/)} />
      {props.children}
    </PlateElement>
  );
}
