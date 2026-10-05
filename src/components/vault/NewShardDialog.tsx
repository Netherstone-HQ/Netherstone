import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { isPathWithin, resolveVaultRelativePath } from "@/lib/drawing-files";
import { useEditorStore } from "@/store/editor";
import { useSettingsStore } from "@/store/settings";
import { useVaultStore } from "@/store/vault";
import { openEditorFile } from "@/lib/open-editor-file";

interface NewShardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The vault root, or the open shard's folder when Settings asks for it. */
function getNewShardFolder(vaultPath: string): string {
  const openPath = useEditorStore.getState().currentFilePath;
  if (
    useSettingsStore.getState().newShardLocation !== "current-folder" ||
    !openPath ||
    !isPathWithin(openPath, vaultPath)
  ) {
    return vaultPath;
  }
  const folder = openPath.replace(/[\\/][^\\/]*$/, "");
  return folder || vaultPath;
}

export function NewShardDialog({ open, onOpenChange }: NewShardDialogProps) {
  const [shardName, setShardName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentVaultPath = useVaultStore((s) => s.currentVaultPath);

  const handleCreate = async () => {
    if (!shardName.trim() || !currentVaultPath) return;

    setIsCreating(true);
    setError(null);

    try {
      // Ensure .md extension
      const fileName = shardName.endsWith(".md")
        ? shardName
        : `${shardName}.md`;

      // Match the folder's separators so the new path equals the one the
      // sidebar lists for it.
      const filePath = resolveVaultRelativePath(
        fileName,
        getNewShardFolder(currentVaultPath),
      );

      // Create empty file with basic template
      const initialContent = `# ${shardName.replace(/\.md$/, "")}\n\n`;

      await invoke("save_markdown_file", {
        filePath,
        content: initialContent,
      });

      await openEditorFile(filePath);

      // Trigger vault rescan to update file tree
      const fileTree = await invoke("scan_vault", {
        vaultPath: currentVaultPath,
      });
      useVaultStore.getState().setFileTree(fileTree as any);

      // Trigger re-indexing
      await invoke("index_vault", { vaultPath: currentVaultPath });

      // Close dialog and reset
      onOpenChange(false);
      setShardName("");
    } catch (err) {
      console.error("Failed to create shard:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && shardName.trim()) {
      e.preventDefault();
      handleCreate();
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!isCreating) {
      onOpenChange(newOpen);
      if (!newOpen) {
        setShardName("");
        setError(null);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Shard</DialogTitle>
          <DialogDescription>
            Create a new markdown file in your vault.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="shard-name">Shard Name</Label>
            <Input
              id="shard-name"
              placeholder="my-new-shard"
              value={shardName}
              onChange={(e) => setShardName(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isCreating}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              The .md extension will be added automatically.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isCreating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={!shardName.trim() || isCreating}
          >
            {isCreating ? "Creating..." : "Create Shard"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
