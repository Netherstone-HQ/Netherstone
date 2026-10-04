import { DotIcon } from "lucide-react";
import type { MetadataSectionProps } from "./types";

export function MetadataSection({
  currentFilePath,
  isLoadingMetadata,
  fileMetadata,
  isDirty,
  metadataRows,
}: MetadataSectionProps) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1">
        <h3 className="text-sm font-semibold">Metadata</h3>
        {isDirty ? (
          <DotIcon
            className="size-4 fill-current text-muted-foreground"
            aria-label="Unsaved changes"
          />
        ) : null}
      </div>

      {!currentFilePath ? (
        <div className="text-xs text-muted-foreground">
          Open a shard to see its metadata.
        </div>
      ) : !fileMetadata ? (
        <div className="text-xs text-muted-foreground">
          Metadata is unavailable for this shard right now. It may have been
          renamed, moved, deleted, or may still be re-indexing.
        </div>
      ) : (
        <div className="space-y-2">
          {metadataRows.map((item) => (
            <div
              key={item.label}
              className="flex items-start justify-between gap-3 text-xs"
            >
              <span className="text-muted-foreground">{item.label}</span>
              <span className="max-w-36 text-right text-foreground">
                {item.value}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
