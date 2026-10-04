import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ShardDialogResult } from "@/lib/commands";

interface ImportShardDialogProps {
  shard: ShardDialogResult | null;
  onImport: () => void;
  onOpenVault: () => void;
  onClose: () => void;
}

export function ImportShardDialog({
  shard,
  onImport,
  onOpenVault,
  onClose,
}: ImportShardDialogProps) {
  const fileName = shard?.filePath.split(/[\\/]/).pop() ?? "";

  return (
    <Dialog open={shard !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shard is Outside of Vault</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{fileName}</strong> is outside
            your current vault. What would you like to do?
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="outline" onClick={onOpenVault}>
            Switch Vault
          </Button>
          <Button onClick={onImport}>Import into Vault</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
