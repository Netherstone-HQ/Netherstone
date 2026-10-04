"use client";

import * as React from "react";

import {
  FolderInputIcon,
  HardDriveIcon,
  Link2Icon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  describeMissingAttachment,
  type MissingAttachmentInfo,
} from "@/lib/commands";
import { toVaultRelativePath } from "@/lib/drawing-files";
import { useVaultStore } from "@/store/vault";
import { cn } from "@/lib/utils";

type MediaStatusTone = "default" | "warning" | "destructive" | "muted";

type MediaStatusAction = {
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  target?: React.AnchorHTMLAttributes<HTMLAnchorElement>["target"];
  rel?: React.AnchorHTMLAttributes<HTMLAnchorElement>["rel"];
  variant?: React.ComponentProps<typeof Button>["variant"];
};

export type MediaStatusCardProps = {
  title: string;
  description: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  details?: React.ReactNode;
  actions?: MediaStatusAction[];
  footer?: React.ReactNode;
  className?: string;
  tone?: MediaStatusTone;
};

function getToneClasses(tone: MediaStatusTone) {
  switch (tone) {
    case "warning":
      return {
        badge:
          "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        card: "border-amber-500/20 bg-amber-500/5",
        icon: "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      };
    case "destructive":
      return {
        badge: "border-destructive/20 bg-destructive/10 text-destructive",
        card: "border-destructive/20 bg-destructive/5",
        icon: "border-destructive/20 bg-destructive/10 text-destructive",
      };
    case "muted":
      return {
        badge: "border-border bg-muted text-muted-foreground",
        card: "border-border bg-muted/30",
        icon: "border-border bg-muted text-muted-foreground",
      };
    case "default":
    default:
      return {
        badge: "border-primary/20 bg-primary/10 text-primary",
        card: "border-border bg-card",
        icon: "border-primary/20 bg-primary/10 text-primary",
      };
  }
}

function MediaStatusActions({ actions }: { actions?: MediaStatusAction[] }) {
  if (!actions || actions.length === 0) return null;

  const handleActionMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="flex flex-wrap items-center gap-2" contentEditable={false}>
      {actions.map((action) => {
        const key = `${action.label}:${action.href ?? "button"}`;

        if (action.href) {
          return (
            <Button
              key={key}
              asChild
              size="sm"
              variant={action.variant ?? "outline"}
            >
              <a
                href={action.href}
                rel={action.rel}
                target={action.target}
                aria-disabled={action.disabled || undefined}
                contentEditable={false}
                data-plate-prevent-deselect
                onMouseDown={handleActionMouseDown}
                onClick={(event) => {
                  event.stopPropagation();

                  if (action.disabled) {
                    event.preventDefault();
                    return;
                  }

                  action.onClick?.();
                }}
              >
                {action.icon}
                {action.label}
              </a>
            </Button>
          );
        }

        return (
          <Button
            key={key}
            type="button"
            size="sm"
            variant={action.variant ?? "outline"}
            disabled={action.disabled}
            data-plate-prevent-deselect
            onMouseDown={handleActionMouseDown}
            onClick={(event) => {
              event.stopPropagation();

              if (action.disabled) {
                event.preventDefault();
                return;
              }

              action.onClick?.();
            }}
          >
            {action.icon}
            {action.label}
          </Button>
        );
      })}
    </div>
  );
}

export function MediaStatusCard({
  title,
  description,
  icon,
  badge,
  meta,
  details,
  actions,
  footer,
  className,
  tone = "default",
}: MediaStatusCardProps) {
  const toneClasses = getToneClasses(tone);

  return (
    <div
      className={cn(
        "rounded-xl border p-4 shadow-xs",
        toneClasses.card,
        className,
      )}
      contentEditable={false}
      data-plate-prevent-deselect
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 inline-flex size-10 shrink-0 items-center justify-center rounded-lg border",
            toneClasses.icon,
          )}
        >
          {icon ?? <TriangleAlertIcon className="size-4" />}
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm leading-none">{title}</h3>

              {badge ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-[11px]",
                    toneClasses.badge,
                  )}
                >
                  {badge}
                </span>
              ) : null}
            </div>

            <div className="text-muted-foreground text-sm leading-6">
              {description}
            </div>
          </div>

          {meta ? (
            <div className="rounded-lg border bg-background/70 px-3 py-2 text-muted-foreground text-xs leading-5">
              {meta}
            </div>
          ) : null}

          {details ? (
            <div className="text-muted-foreground text-xs leading-5">
              {details}
            </div>
          ) : null}

          <MediaStatusActions actions={actions} />
          {footer}
        </div>
      </div>
    </div>
  );
}

export type MissingLocalMediaCardProps = {
  name?: string | null;
  path?: string | null;
  className?: string;
  onLocate?: () => void;
  onImportToVault?: () => void;
  onRemove?: () => void;
  disableActions?: boolean;
};

export function MissingLocalMediaCard({
  name,
  path,
  className,
  onLocate,
  onImportToVault,
  onRemove,
  disableActions = false,
}: MissingLocalMediaCardProps) {
  const displayName = name?.trim() || "Linked local file";

  return (
    <MediaStatusCard
      className={className}
      tone="warning"
      icon={<TriangleAlertIcon className="size-4" />}
      title="Local file not found"
      badge="Local reference"
      description={
        <>
          <span className="font-medium text-foreground">{displayName}</span> was
          linked from the machine where it was inserted and is no longer
          available at its saved location.
        </>
      }
      meta={
        path ? (
          <>
            <span className="font-medium text-foreground">Saved path:</span>{" "}
            <span className="break-all">{path}</span>
          </>
        ) : (
          "No saved local path is available for this item."
        )
      }
      details="The file may have been moved, renamed, deleted, or may not exist on this device."
      actions={[
        {
          label: "Locate file",
          onClick: onLocate,
          disabled: disableActions || !onLocate,
        },
        {
          label: "Import into vault",
          onClick: onImportToVault,
          disabled: disableActions || !onImportToVault,
          variant: "outline",
        },
        {
          label: "Remove",
          onClick: onRemove,
          disabled: disableActions || !onRemove,
          variant: "ghost",
        },
      ]}
    />
  );
}

export type MissingVaultAttachmentCardProps = {
  name?: string | null;
  attachmentPath?: string | null;
  className?: string;
  onRelink?: () => void;
  /** Relinks to a file found in the vault with the same content. */
  onRelinkTo?: (absolutePath: string) => void;
  onRemove?: () => void;
  disableActions?: boolean;
};

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).pop() ?? filePath;
}

/**
 * Looks up what the database knows about a missing attachment: the name it
 * was imported under, and a file with the same content if it was renamed.
 */
function useMissingAttachmentInfo(attachmentPath?: string | null) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const [info, setInfo] = React.useState<MissingAttachmentInfo | null>(null);

  React.useEffect(() => {
    setInfo(null);
    if (!vaultPath || !attachmentPath) return;

    let cancelled = false;
    describeMissingAttachment(
      vaultPath,
      toVaultRelativePath(attachmentPath, vaultPath),
    )
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch((error) => {
        console.error("[Netherstone] Missing attachment lookup failed:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [attachmentPath, vaultPath]);

  return info;
}

export function MissingVaultAttachmentCard({
  name,
  attachmentPath,
  className,
  onRelink,
  onRelinkTo,
  onRemove,
  disableActions = false,
}: MissingVaultAttachmentCardProps) {
  const info = useMissingAttachmentInfo(attachmentPath);
  const displayName = info?.originalName || name?.trim() || "Vault attachment";
  const foundPath = info?.foundAbsolutePath ?? null;

  return (
    <MediaStatusCard
      className={className}
      tone="destructive"
      icon={<FolderInputIcon className="size-4" />}
      title="Vault attachment missing"
      badge="Vault import"
      description={
        <>
          <span className="font-medium text-foreground">{displayName}</span>{" "}
          should exist inside this vault, but Netherstone could not find it.
        </>
      }
      meta={
        attachmentPath ? (
          <>
            <span className="font-medium text-foreground">
              Attachment path:
            </span>{" "}
            <span className="break-all">{attachmentPath}</span>
          </>
        ) : (
          "No vault attachment path is available for this item."
        )
      }
      details={
        foundPath
          ? `Found a file with the same content at ${getFileName(foundPath)}. It was probably renamed or moved.`
          : "This can happen if the attachment was deleted or moved outside of Netherstone."
      }
      actions={[
        ...(foundPath && onRelinkTo
          ? [
              {
                label: `Use ${getFileName(foundPath)}`,
                onClick: () => onRelinkTo(foundPath),
                disabled: disableActions,
              },
            ]
          : []),
        {
          label: "Locate replacement",
          onClick: onRelink,
          disabled: disableActions || !onRelink,
          ...(foundPath && onRelinkTo ? { variant: "ghost" as const } : {}),
        },
        {
          label: "Remove",
          onClick: onRemove,
          disabled: disableActions || !onRemove,
          variant: "ghost",
        },
      ]}
    />
  );
}

export type LocalReferenceMediaCardProps = {
  name?: string | null;
  path?: string | null;
  className?: string;
  onOpen?: () => void;
  onReveal?: () => void;
  onImportToVault?: () => void;
  onRemove?: () => void;
  disableActions?: boolean;
};

export function LocalReferenceMediaCard({
  name,
  path,
  className,
  onOpen,
  onReveal,
  onImportToVault,
  onRemove,
  disableActions = false,
}: LocalReferenceMediaCardProps) {
  const displayName = name?.trim() || "Linked local file";

  return (
    <MediaStatusCard
      className={className}
      tone="muted"
      icon={<HardDriveIcon className="size-4" />}
      title={displayName}
      badge="Local reference"
      description="This file is linked from your local machine and is not copied into the vault by default."
      meta={
        path ? (
          <>
            <span className="font-medium text-foreground">Local path:</span>{" "}
            <span className="break-all">{path}</span>
          </>
        ) : (
          "This item references a machine-local file."
        )
      }
      details="Local references may not work on other devices and can break if the original file moves."
      actions={[
        {
          label: "Open",
          onClick: onOpen,
          disabled: disableActions || !onOpen,
        },
        {
          label: "Reveal",
          onClick: onReveal,
          disabled: disableActions || !onReveal,
          variant: "outline",
        },
        {
          label: "Import into vault",
          onClick: onImportToVault,
          disabled: disableActions || !onImportToVault,
          variant: "outline",
        },
        {
          label: "Remove",
          onClick: onRemove,
          disabled: disableActions || !onRemove,
          variant: "ghost",
        },
      ]}
    />
  );
}

export type VaultAttachmentMediaCardProps = {
  name?: string | null;
  attachmentPath?: string | null;
  className?: string;
  onOpen?: () => void;
  onReveal?: () => void;
  onConvertToReference?: () => void;
  onRemove?: () => void;
  disableActions?: boolean;
};

export function VaultAttachmentMediaCard({
  name,
  attachmentPath,
  className,
  onOpen,
  onReveal,
  onConvertToReference,
  onRemove,
  disableActions = false,
}: VaultAttachmentMediaCardProps) {
  const displayName = name?.trim() || "Vault attachment";

  return (
    <MediaStatusCard
      className={className}
      tone="default"
      icon={<FolderInputIcon className="size-4" />}
      title={displayName}
      badge="Vault import"
      description="This file is stored inside the vault so it can reopen reliably and travel with your notes."
      meta={
        attachmentPath ? (
          <>
            <span className="font-medium text-foreground">
              Attachment path:
            </span>{" "}
            <span className="break-all">{attachmentPath}</span>
          </>
        ) : (
          "This item is managed as a vault attachment."
        )
      }
      details="Vault attachments are the recommended default for portable note content."
      actions={[
        {
          label: "Open",
          onClick: onOpen,
          disabled: disableActions || !onOpen,
        },
        {
          label: "Reveal",
          onClick: onReveal,
          disabled: disableActions || !onReveal,
          variant: "outline",
        },
        {
          label: "Link original file",
          onClick: onConvertToReference,
          disabled: disableActions || !onConvertToReference,
          icon: <Link2Icon className="size-4" />,
          variant: "outline",
        },
        {
          label: "Remove",
          onClick: onRemove,
          disabled: disableActions || !onRemove,
          variant: "ghost",
        },
      ]}
    />
  );
}

export default MediaStatusCard;
