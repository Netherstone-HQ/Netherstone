import { HighlightedText } from "@/components/HighlightedText";
import {
  getFolderInVault,
  getVaultFileDisplayName,
} from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { useVaultStore } from "@/store";
import { CollapsibleSection, SECTION_NOTE_CLASS } from "./CollapsibleSection";
import type { Backlink } from "./types";

function LinkedFromRow({
  backlink,
  folder,
}: {
  backlink: Backlink;
  /** Where it is in the vault. */
  folder: string;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          void openEditorFile(backlink.path).catch((error) => {
            console.error("[Netherstone] Failed to open shard:", error);
          })
        }
        className="flex w-full flex-col gap-1 rounded-md p-2 text-left text-ui-sm outline-none transition-colors hover:bg-accent/40 focus-visible:bg-accent/40"
      >
        <span className="flex w-full min-w-0 items-baseline gap-2">
          <span className="min-w-0 truncate font-medium">
            {getVaultFileDisplayName(backlink.name)}
          </span>
          {folder ? (
            <span className="min-w-0 shrink truncate text-muted-foreground">
              {folder}
            </span>
          ) : null}
        </span>
        {backlink.excerpt ? (
          <span className="line-clamp-3 text-foreground/80 leading-normal">
            <HighlightedText parts={backlink.excerpt} />
          </span>
        ) : null}
      </button>
    </li>
  );
}

/**
 * The shards that link to or mention the open one, each with the line that
 * does. Null while they load.
 */
export function LinkedFromSection({
  backlinks,
}: {
  backlinks: Backlink[] | null;
}) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);

  return (
    <CollapsibleSection
      section="linkedFrom"
      label="Linked from"
      count={backlinks?.length}
    >
      {backlinks === null ? null : backlinks.length === 0 ? (
        <p className={SECTION_NOTE_CLASS}>
          Shards that link to or @mention this one show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {backlinks.map((backlink) => (
            <LinkedFromRow
              key={backlink.path}
              backlink={backlink}
              folder={
                vaultPath ? getFolderInVault(backlink.path, vaultPath) : ""
              }
            />
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
