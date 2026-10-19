import { SectionHeader } from "@/components/sidebar/SectionHeader";
import {
  ACTIVE_ROW_CLASS,
  ROW_BUTTON_CLASS,
  ROW_CLASS,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { cn } from "@/lib/utils";
import { DATA_SECTIONS, useDataStore } from "@/store/data";
import { showDataSection } from "./DataView";

/** The sidebar in Data mode: the page's sections, to jump between. */
export function DataSidebar() {
  const section = useDataStore((s) => s.section);
  const brokenLinkCount = useDataStore((s) => s.brokenLinks.length);

  return (
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
  );
}
