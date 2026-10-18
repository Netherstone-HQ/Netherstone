"use client";

import type { PlateElementProps } from "platejs/react";
import { PlateElement } from "platejs/react";

import type { TFrontMatterElement } from "@/lib/markdown-front-matter";

import { VerbatimBlock } from "./verbatim-block";

/** The shard's front matter, shown as it is in the file (without the fences). */
export function FrontMatterElement(props: PlateElementProps<TFrontMatterElement>) {
  const lines = props.element.value
    .split(/\r?\n/)
    .slice(1)
    .filter((line, index, all) => !(index === all.length - 1 && /^(---|\.\.\.)\s*$/.test(line)));

  return (
    <PlateElement {...props}>
      <VerbatimBlock label="Front matter" lines={lines} />
      {props.children}
    </PlateElement>
  );
}
