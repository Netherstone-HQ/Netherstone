import { ListBulletsIcon } from "@phosphor-icons/react";
import { scrollPlateToHeading } from "@/lib/plate-toc-headings";
import { Button } from "@/components/ui/button";
import type { TableOfContentsSectionProps } from "./types";

export function TableOfContentsSection({
  currentFilePath,
  plateEditor,
  tocHeadings,
}: TableOfContentsSectionProps) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <ListBulletsIcon className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Table of Contents</h3>
      </div>

      {!currentFilePath ? (
        <div className="text-xs text-muted-foreground">
          Open a shard to see its table of contents.
        </div>
      ) : tocHeadings.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No headings in this shard yet.
        </div>
      ) : (
        <nav className="space-y-1">
          {tocHeadings.map((heading) => (
            <Button
              key={heading.id}
              type="button"
              variant="ghost"
              className="block h-auto w-full justify-start px-0 py-0 text-left text-xs font-normal transition-colors hover:text-foreground"
              style={{
                paddingLeft: `${(heading.depth - 1) * 0.75}rem`,
                color: "hsl(var(--muted-foreground))",
              }}
              onClick={() => {
                scrollPlateToHeading(plateEditor, heading);
              }}
            >
              {heading.title}
            </Button>
          ))}
        </nav>
      )}
    </div>
  );
}
