import { useMemo, useState } from "react";
import { FolderSimpleIcon } from "@phosphor-icons/react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FileTreeNode } from "@/store";

type MoveFileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  filePath: string;
  currentVaultPath: string | null;
  fileTree: FileTreeNode[];
  onMove: (destinationPath: string) => Promise<void> | void;
};

type FolderRowProps = {
  path: string;
  name: string;
  depth: number;
  isCurrent: boolean;
  isLast: boolean;
  ancestorHasNext: boolean[];
  onSelect: (path: string) => Promise<void>;
};

function normalizePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathsEqual(a: string, b: string) {
  return normalizePath(a) === normalizePath(b);
}

function getParentDir(filePath: string, currentVaultPath: string | null) {
  const normalized = normalizePath(filePath);
  const slashIndex = normalized.lastIndexOf("/");

  if (slashIndex === -1) {
    return currentVaultPath ? normalizePath(currentVaultPath) : "";
  }

  return normalized.slice(0, slashIndex);
}

function FolderRow({
  path,
  name,
  depth,
  isCurrent,
  isLast,
  ancestorHasNext,
  onSelect,
}: FolderRowProps) {
  const lineOffset = 12;
  const indentWidth = 20;
  const contentPaddingLeft = depth === 0 ? 12 : depth * indentWidth + 12;

  return (
    <div className="relative">
      {depth > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0"
          style={{ width: contentPaddingLeft }}
        >
          {ancestorHasNext.map((hasNext, index) =>
            hasNext ? (
              <span
                key={`ancestor-${index}`}
                className="absolute top-0 bottom-0 w-px bg-border/70"
                style={{ left: index * indentWidth + lineOffset }}
              />
            ) : null,
          )}

          <span
            className="absolute top-0 bottom-1/2 w-px bg-border/70"
            style={{ left: (depth - 1) * indentWidth + lineOffset }}
          />
          <span
            className="absolute top-1/2 h-px bg-border/70"
            style={{
              left: (depth - 1) * indentWidth + lineOffset,
              width: indentWidth,
            }}
          />
          {!isLast && (
            <span
              className="absolute top-1/2 bottom-0 w-px bg-border/70"
              style={{ left: (depth - 1) * indentWidth + lineOffset }}
            />
          )}
        </div>
      )}

      <Button
        type="button"
        variant="ghost"
        className="h-8 w-full justify-start rounded-md pr-2 text-left"
        style={{ paddingLeft: contentPaddingLeft }}
        disabled={isCurrent}
        onClick={() => onSelect(path)}
      >
        <FolderSimpleIcon className="mr-2 h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {isCurrent && (
          <span className="ml-2 shrink-0 text-xs text-muted-foreground">
            (current)
          </span>
        )}
      </Button>
    </div>
  );
}

export function MoveFileDialog({
  open,
  onOpenChange,
  fileName,
  filePath,
  currentVaultPath,
  fileTree,
  onMove,
}: MoveFileDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentParentDir = useMemo(
    () => getParentDir(filePath, currentVaultPath),
    [filePath, currentVaultPath],
  );

  const handleSelect = async (destinationPath: string) => {
    if (isSubmitting || pathsEqual(destinationPath, currentParentDir)) {
      return;
    }

    setIsSubmitting(true);

    try {
      await onMove(destinationPath);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderFolders = (
    nodes: FileTreeNode[],
    depth = 0,
    ancestorHasNext: boolean[] = [],
  ): React.ReactElement[] => {
    const directoryNodes = nodes.filter(
      (node): node is FileTreeNode & { kind: "directory" } =>
        node.kind === "directory",
    );

    return directoryNodes.flatMap((directory, index) => {
      const isLast = index === directoryNodes.length - 1;
      const row = (
        <FolderRow
          key={directory.path}
          path={directory.path}
          name={directory.name}
          depth={depth}
          isCurrent={pathsEqual(directory.path, currentParentDir)}
          isLast={isLast}
          ancestorHasNext={ancestorHasNext}
          onSelect={handleSelect}
        />
      );

      const children = directory.children?.length
        ? renderFolders(directory.children, depth + 1, [
            ...ancestorHasNext,
            !isLast,
          ])
        : [];

      return [row, ...children];
    });
  };

  const folderOptions = renderFolders(fileTree);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Move File</DialogTitle>
          <DialogDescription>
            Select a folder to move "{fileName}" to.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-100 pr-4">
          <div className="space-y-1">
            {currentVaultPath && (
              <FolderRow
                path={currentVaultPath}
                name="Vault Root"
                depth={0}
                isCurrent={pathsEqual(currentVaultPath, currentParentDir)}
                isLast={folderOptions.length === 0}
                ancestorHasNext={[]}
                onSelect={handleSelect}
              />
            )}

            {folderOptions.length > 0 ? (
              folderOptions
            ) : !currentVaultPath ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                No folders available.
              </p>
            ) : null}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default MoveFileDialog;
