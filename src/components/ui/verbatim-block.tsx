"use client";

import { useFocused, useReadOnly, useSelected } from "platejs/react";

import { cn } from "@/lib/utils";

/**
 * A block kept exactly as it is in the file and not editable here: front
 * matter, or HTML the editor has no node for. It can be selected and
 * deleted like any block.
 */
export function VerbatimBlock({ label, lines }: { label: string; lines: string[] }) {
  const readOnly = useReadOnly();
  const selected = useSelected();
  const focused = useFocused();

  return (
    <div
      className={cn(
        "my-2 rounded-md border border-border/60 bg-muted/40 px-3 py-2 font-mono text-ui-sm text-muted-foreground",
        selected && focused && "ring-2 ring-ring ring-offset-2",
        !readOnly && "cursor-default",
      )}
      contentEditable={false}
    >
      <div className="mb-1 font-sans text-[0.7rem] uppercase tracking-wide opacity-70">
        {label}
      </div>
      <pre className="m-0 whitespace-pre-wrap break-words font-mono">{lines.join("\n")}</pre>
    </div>
  );
}
