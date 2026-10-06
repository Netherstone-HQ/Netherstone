/**
 * Saves an export from the export window: asks where, writes the file and
 * says so.
 */

import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { chooseExportPath } from "@/lib/commands";

import type { ExportOptions } from "./options";
import { writeExport, type PreparedExport } from "./pipeline";

const LAST_DIRECTORY_KEY = "netherstone-export-directory";

function readLastDirectory() {
  try {
    return localStorage.getItem(LAST_DIRECTORY_KEY);
  } catch {
    return null;
  }
}

function rememberDirectory(filePath: string) {
  try {
    localStorage.setItem(LAST_DIRECTORY_KEY, filePath.replace(/[\\/][^\\/]*$/, ""));
  } catch {
    // Only a convenience; the dialog falls back to its own default.
  }
}

/**
 * Asks where to save, writes the file and says so. Returns false if the
 * user cancelled the save dialog; throws if the export failed.
 */
export async function saveExport(
  prepared: PreparedExport,
  options: ExportOptions,
  shardName: string,
): Promise<boolean> {
  const outputPath = await chooseExportPath(shardName, options.format, readLastDirectory());
  if (!outputPath) return false;

  await writeExport(prepared, options, outputPath);
  rememberDirectory(outputPath);

  const missing = prepared.missingImages;
  const description = missing
    ? missing === 1
      ? "1 image couldn't be found and is marked in the file."
      : `${missing} images couldn't be found and are marked in the file.`
    : undefined;

  toast.success(`Exported ${outputPath.split(/[\\/]/).pop()}`, {
    description,
    action: {
      label: "Show in folder",
      onClick: () => {
        void revealItemInDir(outputPath).catch((error) =>
          console.error("[Netherstone] Failed to reveal export:", error),
        );
      },
    },
  });
  return true;
}
