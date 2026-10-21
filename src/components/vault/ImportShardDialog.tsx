import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  closeOutsideShard,
  importOutsideShard,
  openOutsideShardVault,
  useOutsideShard,
} from "@/lib/open-shard-file";

/** Asks what to do with a shard opened from outside the vault. */
export function ImportShardDialog() {
  const shard = useOutsideShard((s) => s.shard);
  const fileName = shard?.filePath.split(/[\\/]/).pop() ?? "";

  return (
    <Dialog
      open={shard !== null}
      onOpenChange={(open) => !open && closeOutsideShard()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shard is outside the vault</DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{fileName}</strong> is outside
            your current vault. What would you like to do?
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 pt-2">
          <Button variant="outline" onClick={() => void openOutsideShardVault()}>
            Switch vault
          </Button>
          <Button onClick={() => void importOutsideShard()}>
            Import into vault
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
