import { Fragment } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/tooltip";
import { ActionsMenu } from "@/components/vault/RowActions";
import {
  useVaultItem,
  type VaultItemOptions,
} from "@/components/vault/useVaultItem";
import { toVaultRelativePath } from "@/lib/drawing-files";
import { useUIStore, useVaultStore } from "@/store";

function Slash() {
  return (
    <span aria-hidden="true" className="text-muted-foreground/60">
      /
    </span>
  );
}

/** What the file's name menu offers beyond the file tree's actions. */
type FileMenuOptions = Pick<
  VaultItemOptions,
  "onSave" | "onClose" | "leadingActions" | "exportActions"
>;

/**
 * The open file's place in the vault: the vault itself while the left
 * sidebar is hidden (its top row names it otherwise), the folders, which
 * reveal themselves in the tree, and the file's name, which opens its actions.
 */
export function FileBreadcrumb({
  path,
  ...menuOptions
}: { path: string | null } & FileMenuOptions) {
  const vaultPath = useVaultStore((s) => s.currentVaultPath);
  const isSidebarOpen = useUIStore((s) => s.isSidebarOpen);

  if (!vaultPath) return null;

  const vaultName = vaultPath.split(/[\\/]/).pop() ?? vaultPath;

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 items-center gap-0.5 text-ui"
    >
      {isSidebarOpen ? null : (
        <>
          <span className="shrink-0 px-1 text-muted-foreground">
            {vaultName}
          </span>
          {path ? <Slash /> : null}
        </>
      )}
      {path ? (
        <FileCrumbs path={path} vaultPath={vaultPath} {...menuOptions} />
      ) : null}
    </nav>
  );
}

function FileCrumbs({
  path,
  vaultPath,
  ...menuOptions
}: { path: string; vaultPath: string } & FileMenuOptions) {
  const revealInTree = useUIStore((s) => s.revealInTree);
  const segments = toVaultRelativePath(path, vaultPath).split("/");
  const name = segments[segments.length - 1];
  const folders = segments.slice(0, -1);
  const item = useVaultItem({ name, path, kind: "file" }, menuOptions);

  return (
    <>
      {folders.map((folder, index) => (
        <Fragment key={index}>
          <Hint label="Show in Files" side="bottom">
            <button
              type="button"
              onClick={() =>
                revealInTree(
                  `${vaultPath}/${folders.slice(0, index + 1).join("/")}`,
                )
              }
              className="min-w-0 max-w-48 truncate rounded-sm px-1 py-0.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {folder}
            </button>
          </Hint>
          <Slash />
        </Fragment>
      ))}
      {item.isRenaming ? (
        <Input
          {...item.renameInputProps}
          aria-label="Name"
          className="ml-0.5 h-control w-56 px-1.5 py-0 text-ui"
        />
      ) : (
        <ActionsMenu actions={item.actions} align="start">
          <Button
            type="button"
            variant="ghost"
            className="h-control min-w-0 gap-1 px-1.5 text-ui"
          >
            <span className="truncate">{item.displayName}</span>
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </Button>
        </ActionsMenu>
      )}
      {item.dialogs}
    </>
  );
}
