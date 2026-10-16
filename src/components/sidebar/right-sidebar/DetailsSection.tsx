import { useUIStore, useVaultStore } from "@/store";
import { useTagsStore } from "@/store/tags";
import { CollapsibleSection, SECTION_NOTE_CLASS } from "./CollapsibleSection";
import { formatFileSize, formatTimestamp } from "./link-utils";
import type { FileMetadata } from "./types";

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </div>
  );
}

function openTag(tag: string) {
  const vaultPath = useVaultStore.getState().currentVaultPath;
  if (!vaultPath) return;
  useTagsStore.getState().showTag(vaultPath, tag);
  useUIStore.getState().openMode("tags");
}

/**
 * The open shard's dates, size and tags, as indexed: undefined while they
 * load, null if the shard can't be indexed.
 */
export function DetailsSection({
  details,
}: {
  details: FileMetadata | null | undefined;
}) {
  return (
    <CollapsibleSection section="details" label="Details">
      {details === undefined ? null : details === null ? (
        <p className={SECTION_NOTE_CLASS}>
          Details aren't available for this shard.
        </p>
      ) : (
        <dl className="flex flex-col gap-2 px-1.5 pt-1 text-ui-sm">
          <DetailRow label="Created">
            {formatTimestamp(details.created_at)}
          </DetailRow>
          <DetailRow label="Modified">
            {formatTimestamp(details.last_modified)}
          </DetailRow>
          <DetailRow label="Words">
            {details.word_count.toLocaleString()}
          </DetailRow>
          <DetailRow label="Characters">
            {details.character_count.toLocaleString()}
          </DetailRow>
          <DetailRow label="Size">
            {formatFileSize(details.file_size)}
          </DetailRow>
          {details.tags.length > 0 ? (
            <DetailRow label="Tags">
              <span className="flex flex-wrap justify-end gap-1">
                {details.tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => openTag(tag)}
                    className="rounded-full bg-sidebar-primary/15 px-2 text-sidebar-primary outline-none transition-colors hover:bg-sidebar-primary/25 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    #{tag}
                  </button>
                ))}
              </span>
            </DetailRow>
          ) : null}
        </dl>
      )}
    </CollapsibleSection>
  );
}
