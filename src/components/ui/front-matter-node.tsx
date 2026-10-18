"use client";

import type { PlateElementProps } from "platejs/react";
import { PlateElement, useFocused, useReadOnly, useSelected } from "platejs/react";

import type { TFrontMatterElement } from "@/lib/markdown-front-matter";
import { cn } from "@/lib/utils";

/**
 * The shard's front matter, shown as it is in the file. It can't be edited
 * here yet; it can be selected and deleted like any block.
 */
export function FrontMatterElement(props: PlateElementProps<TFrontMatterElement>) {
  const readOnly = useReadOnly();
  const selected = useSelected();
  const focused = useFocused();
  const lines = props.element.value
    .split(/\r?\n/)
    .slice(1)
    .filter((line, index, all) => !(index === all.length - 1 && /^(---|\.\.\.)\s*$/.test(line)));

  return (
    <PlateElement {...props}>
      <div
        className={cn(
          "my-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-ui-sm text-muted-foreground",
          selected && focused && "ring-2 ring-ring ring-offset-2",
          !readOnly && "cursor-default",
        )}
        contentEditable={false}
      >
        <div className="mb-1 font-sans text-[0.7rem] uppercase tracking-wide opacity-70">
          Front matter
        </div>
        <pre className="m-0 whitespace-pre-wrap break-words font-mono">
          {lines.join("\n")}
        </pre>
      </div>
      {props.children}
    </PlateElement>
  );
}
