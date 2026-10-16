import { scrollPlateToHeading } from "@/lib/plate-toc-headings";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/store/editor";
import { CollapsibleSection, SECTION_NOTE_CLASS } from "./CollapsibleSection";

const INDENT_PX = 14;
/** Where the top level's text starts. */
const TEXT_PX = 8;
/** How far past its heading's first letter a level's guide sits. */
const GUIDE_INSET_PX = 3;

export function OutlineSection() {
  const plateEditor = useEditorStore((s) => s.plateEditor);
  const tocHeadings = useEditorStore((s) => s.tocHeadings);
  // Indent from the shallowest heading, so a shard that starts at H2 isn't
  // pushed in by a level it doesn't use.
  const topDepth = Math.min(...tocHeadings.map((h) => h.depth));

  return (
    <CollapsibleSection
      section="outline"
      label="Outline"
      count={tocHeadings.length}
    >
      {tocHeadings.length === 0 ? (
        <p className={SECTION_NOTE_CLASS}>
          Headings you add to this shard show up here.
        </p>
      ) : (
        <nav aria-label="Outline">
          {tocHeadings.map((heading) => {
            const level = heading.depth - topDepth;
            return (
              <button
                key={heading.id}
                type="button"
                className={cn(
                  "relative block w-full truncate rounded-sm py-1 pr-1 text-left text-ui-sm outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:bg-accent/40",
                  level === 0
                    ? "font-medium text-foreground"
                    : "text-sidebar-foreground/85",
                )}
                style={{ paddingLeft: TEXT_PX + level * INDENT_PX }}
                onClick={() =>
                  plateEditor && scrollPlateToHeading(plateEditor, heading)
                }
              >
                {/* One guide per level, under the heading it belongs to, like
                    the file tree. */}
                {Array.from({ length: level }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-border"
                    style={{ left: TEXT_PX + i * INDENT_PX + GUIDE_INSET_PX }}
                  />
                ))}
                {heading.title}
              </button>
            );
          })}
        </nav>
      )}
    </CollapsibleSection>
  );
}
