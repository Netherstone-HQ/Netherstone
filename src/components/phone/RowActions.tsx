import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MoveFileDialog } from "@/components/vault/MoveFileDialog";
import { renameItem } from "@/components/vault/item-actions";
import { getVaultFileDisplayName } from "@/lib/drawing-files";
import { useVaultStore, type FileTreeNode } from "@/store";
import { closeActions, moveAll, runTrash } from "./item-batch";
import { NameSheet } from "./NameSheet";
import { usePhoneNav, usePhoneOverlay, type PhoneOverlay } from "./nav";
import { RowMenuSheet } from "./RowMenuSheet";
import { findNode } from "./vault-tree";

type Of<K extends PhoneOverlay["kind"]> = Extract<PhoneOverlay, { kind: K }>;

/**
 * The overlay of `kind` while it's open, and the last one after it closes,
 * so its sheet can slide away showing what it showed.
 */
function useLast<K extends PhoneOverlay["kind"]>(kind: K) {
  const overlay = usePhoneOverlay();
  const [last, setLast] = useState<Of<K> | null>(null);
  const current = overlay?.kind === kind ? (overlay as Of<K>) : null;
  if (current && current !== last) setLast(current);
  return { open: current !== null, overlay: current ?? last };
}

/** Closes `kind` when its sheet or dialog asks to, unless it's gone already. */
function closer(kind: PhoneOverlay["kind"]) {
  return (open: boolean) => {
    if (open) return;
    const { entries, back } = usePhoneNav.getState();
    if (entries[entries.length - 1]?.kind === kind) back();
  };
}

function displayName(node: FileTreeNode) {
  return node.kind === "file" ? getVaultFileDisplayName(node.name) : node.name;
}

/** "“Overview”", or "3 items" for several. */
function describe(paths: string[]) {
  if (paths.length !== 1) return `${paths.length} items`;
  return `“${getVaultFileDisplayName(paths[0].split(/[\\/]/).pop() ?? paths[0])}”`;
}

/** The menu, sheets and dialogs that rows and select mode open. */
export function RowActions() {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const fileTree = useVaultStore((s) => s.fileTree);
  const menu = useLast("row-menu");
  const rename = useLast("rename");
  const move = useLast("move");
  const trash = useLast("confirm-trash");

  const nodesOf = (paths: string[]) =>
    paths
      .map((path) => findNode(fileTree, path))
      .filter((node): node is FileTreeNode => node !== null);
  const renaming = rename.overlay
    ? findNode(fileTree, rename.overlay.path)
    : null;
  const moving = nodesOf(move.overlay?.paths ?? []);
  const trashing = trash.overlay?.paths ?? [];

  return (
    <>
      {menu.overlay ? (
        <RowMenuSheet
          path={menu.overlay.path}
          open={menu.open}
          onOpenChange={closer("row-menu")}
        />
      ) : null}

      {renaming ? (
        <NameSheet
          key={renaming.path}
          open={rename.open}
          onOpenChange={closer("rename")}
          title="Rename"
          initialName={displayName(renaming)}
          submitLabel="Rename"
          onCreate={async (name) => {
            try {
              if (name !== displayName(renaming))
                await renameItem(renaming, name);
              closeActions();
              return null;
            } catch (error) {
              return error instanceof Error ? error.message : String(error);
            }
          }}
        />
      ) : null}

      {moving.length > 0 ? (
        <MoveFileDialog
          open={move.open}
          onOpenChange={closer("move")}
          fileName={
            moving.length === 1
              ? displayName(moving[0])
              : `${moving.length} items`
          }
          filePath={moving[0].path}
          isFolder={moving[0].kind === "directory"}
          currentVaultPath={vaultPath}
          fileTree={fileTree}
          onMove={(destination) =>
            moveAll(
              moving.map((node) => node.path),
              destination,
            )
          }
        />
      ) : null}

      <AlertDialog open={trash.open} onOpenChange={closer("confirm-trash")}>
        <AlertDialogContent aria-describedby={undefined}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Move {describe(trashing)} to trash?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(event) => {
                // Stays open until the files have gone, then closes with
                // what opened it.
                event.preventDefault();
                void runTrash(trashing);
              }}
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
