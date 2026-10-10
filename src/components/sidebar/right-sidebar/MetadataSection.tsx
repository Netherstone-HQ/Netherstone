import { DotIcon } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import type { MetadataSectionProps } from "./types";

export function MetadataSection({
  currentFilePath,
  isLoadingMetadata,
  fileMetadata,
  isDirty,
  metadataRows,
}: MetadataSectionProps) {
  return (
    <CollapsibleSection
      section="metadata"
      title="Metadata"
      adornment={
        isDirty ? (
          <DotIcon
            className="-ml-1.5 size-4 fill-current text-muted-foreground"
            aria-label="Unsaved changes"
          />
        ) : null
      }
    >
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
    </CollapsibleSection>
  );
}
