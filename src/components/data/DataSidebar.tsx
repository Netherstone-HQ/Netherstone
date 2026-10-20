import { SectionHeader } from "@/components/sidebar/SectionHeader";
import {
  ACTIVE_ROW_CLASS,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { getFolderInVault, getVaultFileDisplayName } from "@/lib/drawing-files";
import { openEditorFile } from "@/lib/open-editor-file";
import { cn } from "@/lib/utils";
import { useAttachmentReportStore, useUIStore, useVaultStore } from "@/store";
import { DATA_SECTIONS, useDataStore } from "@/store/data";
import { missingFileRows, showDataSection } from "./DataView";

async function openChartShard(path: string) {
  try {
    await openEditorFile(path);
    useUIStore.getState().openMode("editor");
  } catch (error) {
    console.error("[Netherstone] Failed to open shard from Overview:", error);
  }
}

/** The shards with charts, each opening in the Editor. */
function ChartShards() {
  const shards = useDataStore((s) => s.chartShards);
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  if (shards.length === 0 || !vaultPath) return null;

  return (
    <section aria-label="Charts in your shards" className="mt-2.5 shrink-0">
      <SectionHeader label="Charts in your shards" />
      <ul className="flex flex-col gap-0.5">
        {shards.map((shard) => (
          <li key={shard.path}>
            <div
              className={ROW_CLASS}
              style={{ paddingLeft: `${getRowIndent(0)}px` }}
            >
              <button
                type="button"
                className={ROW_BUTTON_CLASS}
                onClick={() => void openChartShard(shard.path)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {getVaultFileDisplayName(shard.name)}
                </span>
                <span className="min-w-0 shrink truncate px-1 text-ui-sm text-muted-foreground">
                  {getFolderInVault(shard.path, vaultPath)}
                </span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The sidebar on the Overview page: the page's sections, to jump between,
 * and the shards with charts.
 */
export function DataSidebar() {
  const section = useDataStore((s) => s.section);
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const linkCount = useDataStore((s) => s.brokenLinks.length);
  const missingCount = useAttachmentReportStore((s) =>
    s.vaultPath === vaultPath && s.report
      ? missingFileRows(s.report.missing).length
      : 0,
  );
  const brokenLinkCount = linkCount + missingCount;

  return (
    <>
      <section aria-label="On this page" className="shrink-0">
        <SectionHeader label="On this page" />
        <ul className="flex flex-col gap-0.5">
          {DATA_SECTIONS.map(({ id, label }) => (
            <li key={id}>
              <div
                className={cn(ROW_CLASS, section === id && ACTIVE_ROW_CLASS)}
                style={{ paddingLeft: `${getRowIndent(0)}px` }}
              >
                <button
                  type="button"
                  aria-current={section === id || undefined}
                  className={ROW_BUTTON_CLASS}
                  onClick={() => showDataSection(id)}
                >
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  {id === "broken-links" && brokenLinkCount > 0 ? (
                    <span className="shrink-0 px-1 text-ui-sm text-muted-foreground tabular-nums">
                      {brokenLinkCount}
                    </span>
                  ) : null}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <ChartShards />
    </>
  );
}
