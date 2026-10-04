import {
  LinkIcon,
  CheckCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { getLinkTargetDisplay } from "./link-utils";
import type { DocumentLinksSectionProps } from "./types";

export function DocumentLinksSection({
  currentFilePath,
  isLoadingLinks,
  documentLinks,
  linkSections,
  onOpenResolvedLink,
}: DocumentLinksSectionProps) {
  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <LinkIcon className="h-4 w-4" />
        <h3 className="text-sm font-semibold">References</h3>
      </div>

      {!currentFilePath ? (
        <div className="text-xs text-muted-foreground">
          Open a shard to inspect its outbound references.
        </div>
      ) : documentLinks.length === 0 ? (
        <div className="text-xs text-muted-foreground">
          This shard does not reference anything yet.
        </div>
      ) : (
        <div className="space-y-4">
          {linkSections.map((section) => (
            <div key={section.kind} className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {section.title} ({section.links.length})
              </div>

              <div className="space-y-2">
                {section.links.map((link, index) => {
                  const isOpenable = Boolean(link.resolvedPath);
                  const content = (
                    <>
                      {link.isValid ? (
                        <CheckCircleIcon className="mt-0.5 h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
                      ) : (
                        <WarningCircleIcon className="mt-0.5 h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />
                      )}
                      <div className="min-w-0 flex-1 text-left">
                        <div
                          className={`truncate ${
                            link.isValid
                              ? "text-foreground"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {link.label}
                        </div>
                        {getLinkTargetDisplay(link) ? (
                          <div className="truncate text-muted-foreground">
                            {getLinkTargetDisplay(link)}
                          </div>
                        ) : null}
                      </div>
                    </>
                  );

                  if (isOpenable && link.resolvedPath) {
                    return (
                      <Button
                        key={`${section.kind}-${index}`}
                        type="button"
                        variant="ghost"
                        className="flex h-auto w-full items-start justify-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-accent/50"
                        onClick={() => {
                          onOpenResolvedLink(link.resolvedPath!);
                        }}
                      >
                        {content}
                      </Button>
                    );
                  }

                  return (
                    <div
                      key={`${section.kind}-${index}`}
                      className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs"
                    >
                      {content}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
