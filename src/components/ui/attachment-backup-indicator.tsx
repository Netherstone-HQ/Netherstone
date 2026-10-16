import { AlertTriangleIcon, CloudOffIcon, HelpCircleIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { describeUnsyncedFiles } from "@/lib/attachment-sync-status";
import { cn } from "@/lib/utils";
import type { PersistedMediaMetadata } from "./media-types";

type AttachmentBackupIndicatorProps = {
  className?: string;
  metadata: PersistedMediaMetadata;
};

const ICONS = {
  blocked: AlertTriangleIcon,
  pending_review: HelpCircleIcon,
  local_only: CloudOffIcon,
};

function getIndicatorCopy(metadata: PersistedMediaMetadata) {
  const status = metadata.netherstoneSyncStatus;
  if (!status || status === "syncable") return null;

  return {
    icon: ICONS[status],
    tone: status === "blocked" ? ("destructive" as const) : ("warning" as const),
    title: "Won't sync",
    description: describeUnsyncedFiles(status, [metadata]),
  };
}

export function AttachmentBackupIndicator({
  className,
  metadata,
}: AttachmentBackupIndicatorProps) {
  const copy = getIndicatorCopy(metadata);

  if (!copy) return null;

  const Icon = copy.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={copy.title}
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background/95 text-muted-foreground shadow-sm backdrop-blur",
            copy.tone === "destructive"
              ? "border-destructive/40 text-destructive"
              : "border-amber-500/40 text-amber-600 dark:text-amber-400",
            className,
          )}
          contentEditable={false}
          role="img"
        >
          <Icon className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6} className="max-w-72">
        <div className="space-y-1">
          <div className="font-medium">{copy.title}</div>
          <div className="text-background/85">{copy.description}</div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
