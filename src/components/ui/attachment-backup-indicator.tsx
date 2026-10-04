import { AlertTriangleIcon, CloudOffIcon, HelpCircleIcon } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PersistedMediaMetadata } from "./media-types";

type AttachmentBackupIndicatorProps = {
  className?: string;
  metadata: PersistedMediaMetadata;
};

function formatBytes(bytes?: number): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
    return null;
  }

  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getIndicatorCopy(metadata: PersistedMediaMetadata) {
  const status = metadata.netherstoneSyncStatus;
  const extension = metadata.netherstoneExtension?.trim().toUpperCase();
  const size = formatBytes(metadata.netherstoneSizeBytes);

  if (!status || status === "syncable") return null;

  if (status === "blocked") {
    return {
      icon: AlertTriangleIcon,
      label: "Not backed up",
      tone: "destructive" as const,
      title: "Blocked from GitHub backup",
      description:
        extension || size
          ? `${extension ? `${extension} file` : "This file"}${size ? ` (${size})` : ""} is stored locally but blocked from GitHub backup by policy.`
          : "This attachment is stored locally but blocked from GitHub backup by policy.",
    };
  }

  if (status === "pending_review") {
    return {
      icon: HelpCircleIcon,
      label: "Review backup",
      tone: "warning" as const,
      title: "Backup needs review",
      description:
        "This attachment is stored locally and needs review before it can be backed up to GitHub.",
    };
  }

  return {
    icon: CloudOffIcon,
    label: "Local only",
    tone: "warning" as const,
    title: "Stored only on this device",
    description:
      extension || size
        ? `${extension ? `${extension} file` : "This file"}${size ? ` (${size})` : ""} is not backed up to GitHub by default.`
        : "This attachment is not backed up to GitHub by default.",
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
