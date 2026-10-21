import { SectionHeader } from "@/components/sidebar/SectionHeader";
import {
  ACTIVE_ROW_CLASS,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { missingFileRows } from "@/lib/data";
import { cn } from "@/lib/utils";
import { useAttachmentReportStore, useVaultStore } from "@/store";
import { DATA_SECTIONS, useDataStore } from "@/store/data";
import { showDataSection } from "./DataView";

/** The sidebar on the Overview page: the page's sections, to jump between. */
export function DataSidebar() {
  const section = useDataStore((s) => s.section);
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const hasCharts = useDataStore((s) => s.chartShards.length > 0);
  const linkCount = useDataStore((s) => s.brokenLinks.length);
  const missingCount = useAttachmentReportStore((s) =>
    s.vaultPath === vaultPath && s.report
      ? missingFileRows(s.report.missing).length
      : 0,
  );
  const brokenCount = linkCount + missingCount;
  const sections = DATA_SECTIONS.filter(
    ({ id }) => id !== "charts" || hasCharts,
  );

  return (
    <section aria-label="On this page" className="shrink-0">
      <SectionHeader label="On this page" />
      <ul className="flex flex-col gap-0.5">
        {sections.map(({ id, label }) => (
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
                {id === "health" && brokenCount > 0 ? (
                  <span className="shrink-0 px-1 text-ui-sm text-muted-foreground tabular-nums">
                    {brokenCount}
                  </span>
                ) : null}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
