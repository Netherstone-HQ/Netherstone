import { LinkBreakIcon, FileTextIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import type { BacklinksSectionProps } from "./types";

export function BacklinksSection({
  currentFilePath,
  isLoadingBacklinks,
  backlinks,
  onOpenResolvedLink,
}: BacklinksSectionProps) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <LinkBreakIcon className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Referenced By</h3>
      </div>

      {!currentFilePath ? (
        <div className="text-xs text-muted-foreground">
          Open a shard to see which other shards reference it.
        </div>
      ) : backlinks.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          No other shards reference this shard yet.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Inbound References ({backlinks.length})
            </div>

            <div className="space-y-2">
              {backlinks.map((link, index) => {
                return (
                  <Button
                    key={`${link.path}-${index}`}
                    type="button"
                    variant="ghost"
                    className="flex h-auto w-full items-start justify-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50"
                    onClick={() => {
                      onOpenResolvedLink(link.path);
                    }}
                  >
                    <FileTextIcon className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-foreground">
                        {link.name}
                      </div>
                      {link.snippet && (
                        <div className="truncate text-muted-foreground">
                          {link.snippet.replace(/<mark>|<\/mark>/g, "")}
                        </div>
                      )}
                    </div>
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
