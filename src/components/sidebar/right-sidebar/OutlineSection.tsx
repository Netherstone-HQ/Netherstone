import { ListIcon } from "lucide-react";
import { scrollPlateToHeading } from "@/lib/plate-toc-headings";
import { cn } from "@/lib/utils";
import { CollapsibleSection } from "./CollapsibleSection";
import type { OutlineSectionProps } from "./types";

const INDENT_PX = 12;
/** Where the first level's guide sits; each level's text starts 7px past it. */
const RAIL_PX = 3;

export function OutlineSection({
  currentFilePath,
  plateEditor,
  tocHeadings,
}: OutlineSectionProps) {
  // Indent from the shallowest heading, so a shard that starts at H2 isn't
  // pushed in by a level it doesn't use.
  const topDepth = Math.min(...tocHeadings.map((h) => h.depth));

  return (
    <CollapsibleSection
      section="outline"
      title="Outline"
      icon={<ListIcon className="size-4" />}
      adornment={
        tocHeadings.length > 0 ? (
          <span className="font-normal text-muted-foreground text-xs tabular-nums">
            {tocHeadings.length}
          </span>
        ) : null
      }
      className="mb-6"
    >
      {!currentFilePath ? (
        <p className="text-muted-foreground text-xs">
          Open a shard to see its outline.
        </p>
      ) : tocHeadings.length === 0 ? (
        <p className="text-muted-foreground text-xs">
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
                  "relative block w-full truncate rounded-sm py-1 pr-1 text-left text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                  level === 0 ? "text-foreground/75" : "text-muted-foreground",
                )}
                style={{ paddingLeft: RAIL_PX + 7 + level * INDENT_PX }}
                onClick={() => scrollPlateToHeading(plateEditor, heading)}
              >
                {/* One guide per level, like the file tree. */}
                {Array.from({ length: level }, (_, i) => (
                  <span
                    key={i}
                    aria-hidden="true"
                    className="absolute inset-y-0 w-px bg-border"
                    style={{ left: RAIL_PX + i * INDENT_PX }}
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
