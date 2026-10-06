"use client";

import { ArrowDownToLineIcon } from "lucide-react";

import { openExportDialog } from "@/lib/export";
import { useEditorStore } from "@/store";

import { ToolbarButton } from "./toolbar";

/** Opens the export window for the open shard. */
export function ExportToolbarButton() {
  const currentFilePath = useEditorStore((s) => s.currentFilePath);

  return (
    <ToolbarButton
      tooltip="Export"
      disabled={!currentFilePath}
      onClick={() => {
        if (currentFilePath) openExportDialog(currentFilePath);
      }}
    >
      <ArrowDownToLineIcon className="size-4" />
    </ToolbarButton>
  );
}
