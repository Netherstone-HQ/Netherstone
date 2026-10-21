import { useEffect } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import { useAttachmentReportStore, useVaultStore } from "@/store";
import { formatBytes, plural } from "@/components/settings/attachment-format";
import { ExternalFilesRow } from "@/components/settings/AttachmentMigrationRows";

export const ATTACHMENTS_SECTION_ID = "settings-attachments";

/**
 * The open vault's attachments, and files linked from outside the attachment
 * folder. Missing and unused files are under Health on the Overview page.
 */
export function AttachmentsSection() {
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);
  const reportVaultPath = useAttachmentReportStore((s) => s.vaultPath);
  const report = useAttachmentReportStore((s) => s.report);
  const isChecking = useAttachmentReportStore((s) => s.isChecking);
  const error = useAttachmentReportStore((s) => s.error);
  const check = useAttachmentReportStore((s) => s.check);

  const isCurrent = !!currentVaultPath && reportVaultPath === currentVaultPath;

  useEffect(() => {
    if (currentVaultPath && reportVaultPath !== currentVaultPath) {
      void check(currentVaultPath);
    }
  }, [check, currentVaultPath, reportVaultPath]);

  if (!currentVaultPath) return null;

  const currentReport = isCurrent ? report : null;

  return (
    <SettingsGroup
      id={ATTACHMENTS_SECTION_ID}
      title="Attachments in this vault"
    >
      <SettingRow
        label={
          currentReport
            ? `${plural(currentReport.fileCount, "file")} · ${formatBytes(currentReport.totalBytes)}`
            : "Files copied into this vault"
        }
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isChecking}
          onClick={() => void check(currentVaultPath)}
        >
          {isChecking ? (
            <Loader2Icon className="animate-spin" />
          ) : (
            <RefreshCwIcon />
          )}
          Check again
        </Button>
      </SettingRow>

      {isCurrent && error && !isChecking ? (
        <p className="px-4 py-3 text-destructive text-ui">
          Couldn't check attachments: {error}
        </p>
      ) : null}

      {currentReport ? (
        currentReport.externalFiles.length > 0 ? (
          <ExternalFilesRow
            files={currentReport.externalFiles}
            vaultPath={currentVaultPath}
          />
        ) : null
      ) : isChecking ? (
        <p className="px-4 py-3 text-muted-foreground text-ui">
          Checking attachments
        </p>
      ) : null}
    </SettingsGroup>
  );
}
